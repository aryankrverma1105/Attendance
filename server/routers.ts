import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { verifyFirebaseToken } from "./_core/firebase";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import {
  getDb,
  getActiveInvitationByPhone,
  activateUserFromInvitation,
  autoActivateUser,
  getAllUsers,
  getUsersByManagerId,
  getUserById,
  updateUserDailyWage,
  getEmployeeWorkedDaysAndEarnings,
} from "./db";
import { TRPCError } from "@trpc/server";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    activate: publicProcedure
      .input(z.object({ idToken: z.string() }))
      .mutation(async ({ input, ctx }) => {
        try {
          let decodedToken: { uid: string; phone_number?: string };
          try {
            decodedToken = await verifyFirebaseToken(input.idToken);
          } catch (tokenErr) {
            if (!ENV.isProduction) {
              // Dev/preview-only fallback: only allowed in non-production environments with explicit mock tokens.
              if (input.idToken.startsWith("mock_token_")) {
                console.warn("[Auth] Token verification fallback for web/preview (dev-only):", tokenErr);
                const clean = input.idToken.replace("mock_token_phone_", "").replace("mock_token_uid_", "");
                const decoded = decodeURIComponent(clean);
                const digits = decoded.replace(/[^0-9]/g, "");
                if (!digits || digits.length < 10) {
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Explicit valid phone number required in mock token.",
                  });
                }
                const phone = decoded.startsWith("+") ? decoded : `+${digits}`;
                decodedToken = {
                  uid: `web_${digits}`,
                  phone_number: phone,
                };
              } else {
                console.error("[Auth] Dev token verification failed:", tokenErr);
                throw new TRPCError({
                  code: "UNAUTHORIZED",
                  message: "Authentication token verification failed. Please log in again.",
                });
              }
            } else {
              // In production, any failure of verifyFirebaseToken must reject the request outright.
              console.error("[Auth] Production token verification failed:", tokenErr);
              throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "Authentication token verification failed. Please log in again.",
              });
            }
          }

          const phoneE164 = decodedToken.phone_number;
          if (!phoneE164) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Phone number verification is required in authentication token",
            });
          }

          const db = await getDb();
          if (!db) {
            console.error("[Database] Database connection unavailable during user activation.");
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Database connection unavailable. Please contact system administrator.",
            });
          }

          let user;
          try {
            const invitation = await getActiveInvitationByPhone(phoneE164);

            if (invitation) {
              user = await activateUserFromInvitation(
                invitation.id,
                decodedToken.uid,
                phoneE164,
                phoneE164.split("@")[0] || "Employee",
                invitation.role
              );
            } else {
              user = await autoActivateUser(
                decodedToken.uid,
                phoneE164,
                phoneE164.split("@")[0] || "Employee"
              );
            }
          } catch (dbError) {
            console.error("[Database] Query failed during user activation:", dbError);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Database query failed during user activation. Please contact system administrator.",
            });
          }

          if (!user) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to activate user account.",
            });
          }

          const sessionToken = await sdk.createSessionToken(user.openId, {
            name: user.name || user.email || user.phoneE164 || "Employee",
            sessionVersion: user.sessionVersion,
          });

          const cookieOptions = getSessionCookieOptions(ctx.req);
          ctx.res.cookie(COOKIE_NAME, sessionToken, cookieOptions);

          return {
            success: true,
            user,
            token: sessionToken,
          };
        } catch (error) {
          console.error("[Auth] Activation failed:", error);
          throw new Error(error instanceof Error ? error.message : "Activation failed");
        }
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  workforce: router({
    /**
     * Authenticated employee dashboard stats computed securely on server.
     * Prevents client spoofing by deriving target employee strictly from session.
     */
    getEmployeeDashboard: protectedProcedure
      .input(z.object({ targetUserId: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        let targetId = ctx.user.id;

        if (input?.targetUserId && input.targetUserId !== ctx.user.id) {
          if (ctx.user.role === "admin") {
            targetId = input.targetUserId;
          } else if (ctx.user.role === "manager") {
            const targetUser = await getUserById(input.targetUserId);
            if (targetUser?.managerId !== ctx.user.id) {
              throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden: Cannot access employee outside your assigned team." });
            }
            targetId = input.targetUserId;
          } else {
            throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden: Employees can only access their own dashboard." });
          }
        }

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;

        let workingDaysInMonth = 0;
        const daysInMonth = new Date(year, month, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
          const dayOfWeek = new Date(year, month - 1, d).getDay();
          if (dayOfWeek !== 0) workingDaysInMonth++;
        }

        const financialStats = await getEmployeeWorkedDaysAndEarnings(targetId, year, month);
        const targetUser = targetId === ctx.user.id ? ctx.user : await getUserById(targetId);

        return {
          userId: targetId,
          name: targetUser?.name || "Employee",
          role: targetUser?.role || "employee",
          workedDays: financialStats.workedDays,
          workingDaysInMonth,
          calculatedEarnings: financialStats.calculatedEarnings,
          dailyWage: financialStats.dailyWage || targetUser?.dailyWage || 0,
          monthName: now.toLocaleString("default", { month: "long" }),
          year,
        };
      }),

    /**
     * Monthly earnings history with accurate effective wage rate calculations.
     */
    getEarningsHistory: protectedProcedure
      .input(
        z.object({
          monthsCount: z.number().min(1).max(12).default(6),
          targetUserId: z.number().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        let targetId = ctx.user.id;

        if (input.targetUserId && input.targetUserId !== ctx.user.id) {
          if (ctx.user.role === "admin") {
            targetId = input.targetUserId;
          } else if (ctx.user.role === "manager") {
            const targetUser = await getUserById(input.targetUserId);
            if (targetUser?.managerId !== ctx.user.id) {
              throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden: Cannot access employee earnings outside your team." });
            }
            targetId = input.targetUserId;
          } else {
            throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden: Employees can only access their own earnings history." });
          }
        }

        const now = new Date();
        const results = [];

        for (let i = 0; i < input.monthsCount; i++) {
          const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const year = date.getFullYear();
          const month = date.getMonth() + 1;
          const monthName = date.toLocaleString("default", { month: "long" });

          const stats = await getEmployeeWorkedDaysAndEarnings(targetId, year, month);
          results.push({
            year,
            month,
            monthName,
            workedDays: stats.workedDays,
            dailyWage: stats.dailyWage,
            calculatedEarnings: stats.calculatedEarnings,
            workedDates: stats.workedDates,
          });
        }

        return results;
      }),

    /**
     * Admin overview: All users, team wage summary, and workforce KPIs.
     */
    getAdminOverview: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden: Admin access required." });
      }

      const allUsers = await getAllUsers();
      const activeCount = allUsers.filter((u) => u.accountStatus === "active").length;
      const managerCount = allUsers.filter((u) => u.role === "manager").length;
      const employeeCount = allUsers.filter((u) => u.role === "employee").length;

      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      let totalMonthlyPayroll = 0;
      const userSummaries = [];

      for (const u of allUsers) {
        let workedDaysThisMonth = 0;
        let earningsThisMonth = 0;

        if (u.role === "employee") {
          const stats = await getEmployeeWorkedDaysAndEarnings(u.id, year, month);
          workedDaysThisMonth = stats.workedDays;
          earningsThisMonth = stats.calculatedEarnings;
          totalMonthlyPayroll += earningsThisMonth;
        }

        userSummaries.push({
          id: u.id,
          name: u.name,
          phoneE164: u.phoneE164,
          email: u.email,
          role: u.role,
          accountStatus: u.accountStatus,
          dailyWage: u.role === "employee" ? u.dailyWage : null,
          managerId: u.managerId,
          workedDaysThisMonth,
          earningsThisMonth,
        });
      }

      return {
        totalEmployees: allUsers.length,
        activeEmployees: activeCount,
        managersCount: managerCount,
        employeesCount: employeeCount,
        totalMonthlyPayroll,
        users: userSummaries,
      };
    }),

    /**
     * Manager overview: Scoped strictly to team members.
     */
    getManagerOverview: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden: Manager access required." });
      }

      const teamUsers =
        ctx.user.role === "admin"
          ? await getAllUsers()
          : await getUsersByManagerId(ctx.user.id);

      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      let teamMonthlyPayroll = 0;
      let teamTotalWorkedDays = 0;
      const teamSummaries = [];

      for (const u of teamUsers) {
        let workedDaysThisMonth = 0;
        let earningsThisMonth = 0;

        if (u.role === "employee") {
          const stats = await getEmployeeWorkedDaysAndEarnings(u.id, year, month);
          workedDaysThisMonth = stats.workedDays;
          earningsThisMonth = stats.calculatedEarnings;
          teamMonthlyPayroll += earningsThisMonth;
          teamTotalWorkedDays += workedDaysThisMonth;
        }

        teamSummaries.push({
          id: u.id,
          name: u.name,
          phoneE164: u.phoneE164,
          role: u.role,
          accountStatus: u.accountStatus,
          dailyWage: u.role === "employee" ? u.dailyWage : null,
          workedDaysThisMonth,
          earningsThisMonth,
        });
      }

      return {
        teamSize: teamUsers.length,
        teamTotalWorkedDays,
        teamMonthlyPayroll,
        teamMembers: teamSummaries,
      };
    }),

    /**
     * Scoped list of users:
     * - Admin: all users
     * - Manager: own assigned team only
     * - Employee: forbidden
     */
    listUsers: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role === "admin") {
        return await getAllUsers();
      } else if (ctx.user.role === "manager") {
        return await getUsersByManagerId(ctx.user.id);
      } else {
        throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden: Employees do not have directory access." });
      }
    }),

    /**
     * Update employee daily wage with strict Admin-only authorization.
     */
    setEmployeeWage: protectedProcedure
      .input(
        z.object({
          targetUserId: z.number().int().positive(),
          dailyWage: z.number().int().min(0).max(100000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Forbidden: Only Administrators are authorized to set or modify employee wages.",
          });
        }
        return await updateUserDailyWage(
          ctx.user.openId,
          ctx.user.role,
          ctx.user.id,
          input.targetUserId,
          input.dailyWage
        );
      }),

    /**
     * Create a new user (Admin, Manager, Employee) directly with phone number.
     */
    createUser: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          phoneE164: z.string().min(10),
          role: z.enum(["admin", "manager", "employee"]),
          department: z.string().optional(),
          dailyWage: z.number().optional(),
          managerId: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Forbidden: Only Administrators can create new accounts.",
          });
        }
        const { createUserByAdmin } = await import("./db");
        return await createUserByAdmin(ctx.user, input);
      }),

    /**
     * Update user account status (suspend, pause, reactivate, deactivate).
     */
    updateUserStatus: protectedProcedure
      .input(
        z.object({
          targetUserId: z.number().int().positive(),
          accountStatus: z.enum(["active", "suspended", "removed"]).optional(),
          role: z.enum(["admin", "manager", "employee"]).optional(),
          managerId: z.number().nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Forbidden: Only Administrators can update user lifecycle status.",
          });
        }
        const { updateUserStatusByAdmin } = await import("./db");
        return await updateUserStatusByAdmin(ctx.user, input);
      }),
  }),

  tasks: router({
    /**
     * List tasks for today (or specified date).
     */
    listTodayTasks: protectedProcedure
      .input(z.object({ date: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const { getTasksForUser, getAllTasks, getTasksByManagerId } = await import("./db");
        const todayStr = input?.date || new Date().toISOString().slice(0, 10);
        if (ctx.user.role === "admin") {
          return await getAllTasks(todayStr);
        } else if (ctx.user.role === "manager") {
          return await getTasksByManagerId(ctx.user.id, todayStr);
        } else {
          return await getTasksForUser(ctx.user.id, todayStr);
        }
      }),

    /**
     * List all tasks.
     */
    listAllTasks: protectedProcedure.query(async ({ ctx }) => {
      const { getTasksForUser, getAllTasks, getTasksByManagerId } = await import("./db");
      if (ctx.user.role === "admin") {
        return await getAllTasks();
      } else if (ctx.user.role === "manager") {
        return await getTasksByManagerId(ctx.user.id);
      } else {
        return await getTasksForUser(ctx.user.id);
      }
    }),

    /**
     * Create/Assign a new task to a field employee.
     */
    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1),
          description: z.string().optional(),
          assignedToUserId: z.number().int().positive(),
          scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
          locationLat: z.string().optional(),
          locationLng: z.string().optional(),
          locationAddress: z.string().optional(),
          customerName: z.string().optional(),
          idempotencyKey: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin" && ctx.user.role !== "manager") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden: Only Admin and Managers can assign tasks." });
        }
        const { createTask } = await import("./db");
        return await createTask(ctx.user, input);
      }),

    /**
     * Update task status (Pending -> In Progress -> Completed).
     */
    updateStatus: protectedProcedure
      .input(
        z.object({
          taskId: z.string(),
          status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { updateTaskStatus } = await import("./db");
        return await updateTaskStatus(ctx.user, input.taskId, input.status);
      }),
  }),

  attendance: router({
    /**
     * Employee check-in with GPS and photo evidence.
     * Strictly forbidden for Admin and Manager.
     */
    checkIn: protectedProcedure
      .input(
        z.object({
          checkInPhotoUri: z.string().min(1, "Photo evidence is required for check-in"),
          checkInLat: z
            .string()
            .refine(
              (val) => {
                const n = parseFloat(val);
                return !isNaN(n) && n >= -90 && n <= 90;
              },
              { message: "Invalid latitude: must be between -90 and 90 degrees." }
            ),
          checkInLng: z
            .string()
            .refine(
              (val) => {
                const n = parseFloat(val);
                return !isNaN(n) && n >= -180 && n <= 180;
              },
              { message: "Invalid longitude: must be between -180 and 180 degrees." }
            ),
          checkInAccuracy: z.number().optional(),
          taskId: z.string().optional(),
          targetLat: z.string().optional(),
          targetLng: z.string().optional(),
          geofenceRadiusMeters: z.number().optional(),
          idempotencyKey: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "employee") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Forbidden: Check-in is an operational action restricted strictly to field employees.",
          });
        }
        const { recordAttendanceCheckIn } = await import("./db");
        try {
          return await recordAttendanceCheckIn(ctx.user, input);
        } catch (err: any) {
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err?.message || "Failed to record check-in.",
          });
        }
      }),

    /**
     * Employee check-out.
     * Strictly forbidden for Admin and Manager.
     */
    checkOut: protectedProcedure
      .input(
        z.object({
          checkOutPhotoUri: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "employee") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Forbidden: Check-out is an operational action restricted strictly to field employees.",
          });
        }
        const { recordAttendanceCheckOut } = await import("./db");
        return await recordAttendanceCheckOut(ctx.user, input);
      }),

    /**
     * Manually approve a pending or review attendance record.
     * Strictly restricted to Managers and Administrators.
     */
    approveCheckIn: protectedProcedure
      .input(z.object({ recordId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin" && ctx.user.role !== "manager") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Forbidden: Only Managers and Administrators can approve attendance records.",
          });
        }
        const { approveAttendanceRecord } = await import("./db");
        try {
          return await approveAttendanceRecord(ctx.user, input.recordId);
        } catch (err: any) {
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err?.message || "Failed to approve attendance record.",
          });
        }
      }),

    /**
     * Scoped attendance history query.
     */
    getHistory: protectedProcedure
      .input(
        z.object({
          targetUserId: z.number().optional(),
          month: z.number().optional(),
          year: z.number().optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        const { getAttendanceRecords } = await import("./db");
        return await getAttendanceRecords(ctx.user, input?.targetUserId, input?.month, input?.year);
      }),
  }),

  tracking: router({
    /**
     * Get day-wise GPS history with route timeline and distance.
     */
    getDayRouteHistory: protectedProcedure
      .input(
        z.object({
          targetUserId: z.number().int().positive(),
          recordedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
      )
      .query(async ({ ctx, input }) => {
        const { getDayGpsHistory } = await import("./db");
        return await getDayGpsHistory(ctx.user, input.targetUserId, input.recordedDate);
      }),

    /**
     * Record a GPS point during route tracking.
     * Strictly restricted to field employees only.
     */
    recordPoint: protectedProcedure
      .input(
        z.object({
          recordedDate: z.string(),
          latitude: z.string().refine(
            (val) => {
              const n = parseFloat(val);
              return !isNaN(n) && n >= -90 && n <= 90;
            },
            { message: "Invalid latitude: must be between -90 and 90 degrees." }
          ),
          longitude: z.string().refine(
            (val) => {
              const n = parseFloat(val);
              return !isNaN(n) && n >= -180 && n <= 180;
            },
            { message: "Invalid longitude: must be between -180 and 180 degrees." }
          ),
          accuracy: z.number().optional(),
          address: z.string().optional(),
          taskId: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "employee") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Forbidden: GPS tracking is an operational tool restricted exclusively to field employees.",
          });
        }
        const { recordGpsPoint } = await import("./db");
        try {
          return await recordGpsPoint(ctx.user.id, input);
        } catch (err: any) {
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err?.message || "Failed to record GPS point.",
          });
        }
      }),
  }),

  audit: router({
    /**
     * Read system audit logs. Strictly Admin only.
     */
    getLogs: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden: Audit logs are restricted to Administrators." });
      }
      const { getAuditLogs } = await import("./db");
      return await getAuditLogs(ctx.user);
    }),
  }),

  reports: router({
    /**
     * Organization-wide report. Strictly Admin only.
     */
    getOrganizationReport: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden: Organization reports are restricted to Administrators." });
      }
      const { getAllUsers, getAllTasks } = await import("./db");
      const usersList = await getAllUsers();
      const tasksList = await getAllTasks();
      return {
        totalUsers: usersList.length,
        totalTasks: tasksList.length,
        completedTasks: tasksList.filter((t) => t.status === "COMPLETED").length,
      };
    }),

    /**
     * Team report. Admin or Manager (scoped to own team).
     */
    getTeamReport: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "manager") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden: Team reports are restricted to Managers and Administrators." });
      }
      const { getUsersByManagerId, getTasksByManagerId } = await import("./db");
      const teamUsers = ctx.user.role === "admin" ? await (await import("./db")).getAllUsers() : await getUsersByManagerId(ctx.user.id);
      const teamTasks = ctx.user.role === "admin" ? await (await import("./db")).getAllTasks() : await getTasksByManagerId(ctx.user.id);
      return {
        teamSize: teamUsers.length,
        teamTasksCount: teamTasks.length,
        teamCompletedTasks: teamTasks.filter((t) => t.status === "COMPLETED").length,
      };
    }),
  }),

  customers: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { listCustomers } = await import("./db");
      return await listCustomers(ctx.user);
    }),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          phone: z.string().optional(),
          email: z.string().email().optional().or(z.literal("")),
          address: z.string().optional(),
          latitude: z.string().optional(),
          longitude: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createCustomer } = await import("./db");
        return await createCustomer(ctx.user, input);
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
          address: z.string().optional(),
          latitude: z.string().optional(),
          longitude: z.string().optional(),
          notes: z.string().optional(),
          status: z.enum(["active", "archived"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const { updateCustomer } = await import("./db");
        return await updateCustomer(ctx.user, id, data);
      }),
  }),

  visits: router({
    list: protectedProcedure
      .input(z.object({ date: z.string().optional(), customerId: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const { listVisits } = await import("./db");
        return await listVisits(ctx.user, input);
      }),
    getDetail: protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const { getVisitDetail } = await import("./db");
        return await getVisitDetail(ctx.user, input.id);
      }),
    create: protectedProcedure
      .input(
        z.object({
          customerId: z.string(),
          employeeUserId: z.number().optional(),
          scheduledFor: z.string(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createVisit } = await import("./db");
        return await createVisit(ctx.user, {
          customerId: input.customerId,
          employeeUserId: input.employeeUserId,
          scheduledFor: new Date(input.scheduledFor),
          notes: input.notes,
        });
      }),
    checkIn: protectedProcedure
      .input(
        z.object({
          visitId: z.string(),
          latitude: z.string().optional(),
          longitude: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { checkInVisit } = await import("./db");
        return await checkInVisit(ctx.user, input.visitId, {
          latitude: input.latitude,
          longitude: input.longitude,
        });
      }),
    complete: protectedProcedure
      .input(
        z.object({
          visitId: z.string(),
          latitude: z.string().optional(),
          longitude: z.string().optional(),
          meetingOutcome: z.string().optional(),
          notes: z.string().optional(),
          followUpDate: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { completeVisit } = await import("./db");
        return await completeVisit(ctx.user, input.visitId, {
          latitude: input.latitude,
          longitude: input.longitude,
          meetingOutcome: input.meetingOutcome,
          notes: input.notes,
          followUpDate: input.followUpDate,
        });
      }),
    addEvidence: protectedProcedure
      .input(
        z.object({
          visitId: z.string(),
          evidenceUrl: z.string(),
          latitude: z.string().optional(),
          longitude: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { addVisitEvidence } = await import("./db");
        return await addVisitEvidence(ctx.user, input.visitId, input);
      }),
  }),

  chat: router({
    getOrCreateChannel: protectedProcedure
      .input(z.object({ targetUserId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { getOrCreateDirectChannel } = await import("./db");
        return await getOrCreateDirectChannel(ctx.user, input.targetUserId);
      }),
    getMessages: protectedProcedure
      .input(z.object({ channelId: z.string(), limit: z.number().optional() }))
      .query(async ({ ctx, input }) => {
        const { getChannelMessages } = await import("./db");
        return await getChannelMessages(ctx.user, input.channelId, input.limit);
      }),
    sendMessage: protectedProcedure
      .input(z.object({ channelId: z.string(), message: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { sendChatMessage } = await import("./db");
        return await sendChatMessage(ctx.user, input.channelId, input.message);
      }),
  }),

  expenses: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { listExpenses } = await import("./db");
      return await listExpenses(ctx.user);
    }),
    create: protectedProcedure
      .input(
        z.object({
          amount: z.number().positive(),
          category: z.string().min(1),
          description: z.string().optional(),
          receiptUrl: z.string().optional(),
          expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createExpense } = await import("./db");
        return await createExpense(ctx.user, input);
      }),
    review: protectedProcedure
      .input(
        z.object({
          expenseId: z.string(),
          decision: z.enum(["APPROVED", "REJECTED"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { reviewExpense } = await import("./db");
        return await reviewExpense(ctx.user, input.expenseId, input.decision);
      }),
  }),

  notifications: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getUserNotifications } = await import("./db");
      return await getUserNotifications(ctx.user.id);
    }),
    registerDevice: protectedProcedure
      .input(
        z.object({
          expoPushToken: z.string().optional(),
          deviceModel: z.string().optional(),
          osVersion: z.string().optional(),
          appVersion: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { registerDeviceSession } = await import("./db");
        return await registerDeviceSession(ctx.user.id, input);
      }),
  }),
});

export type AppRouter = typeof appRouter;
