import cron from 'node-cron';
import { query } from '../config/db.js';
import { runOrchestrator } from '../agents/orchestrator.js';

let scheduledTask = null;

/**
 * Scheduled Daily Agent Cycle Job.
 *
 * Runs the autonomous AR agent orchestrator for all registered users on a schedule.
 * Disabled by default; enable by setting ENABLE_CRON_JOBS=true in environment variables.
 *
 * Default Schedule: "0 9 * * 1-5" (Every weekday at 9:00 AM IST in Asia/Kolkata).
 */
export function startCronJobs() {
  const isEnabled = process.env.ENABLE_CRON_JOBS === 'true';
  const schedule = process.env.CRON_SCHEDULE || '0 9 * * 1-5';

  if (!isEnabled) {
    console.log('ℹ️  Automated cron agent jobs: DISABLED (Set ENABLE_CRON_JOBS=true to enable)');
    return null;
  }

  console.log(`⏰ Starting automated AR cron scheduler (${schedule} in Asia/Kolkata)...`);

  scheduledTask = cron.schedule(
    schedule,
    async () => {
      console.log(`\n🔔 [${new Date().toISOString()}] Executing scheduled daily agent cycle...`);
      try {
        const usersRes = await query('select id, email from users');
        console.log(`   Running orchestrator for ${usersRes.rows.length} active user account(s)...`);

        for (const user of usersRes.rows) {
          try {
            const result = await runOrchestrator(user.id);
            console.log(`   ✅ User ${user.email}: Processed ${result.processed?.length || 0} action(s).`);
          } catch (userErr) {
            console.error(`   ❌ Orchestrator error for user ${user.email}:`, userErr.message);
          }
        }
      } catch (err) {
        console.error('❌ Scheduled cron cycle error:', err.message);
      }
    },
    {
      timezone: 'Asia/Kolkata',
    },
  );

  return scheduledTask;
}

export function stopCronJobs() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('🛑 Automated cron agent scheduler stopped.');
  }
}
