import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { SecurityAnalyzer } from './analysis/analyzer.js';
import { AuthorizationGate } from './auth/authorizationGate.js';
import { buildAuthorizedCommandRegistry } from './commands/index.js';
import { loadConfig, sanitizeConfigForDisplay } from './config/index.js';
import { DatabaseManager } from './database/connection.js';
import { PlatformRepositories } from './database/repositories.js';
import { EvidenceStore } from './evidence/evidenceStore.js';
import { AstraAstraAdapter } from './integrations/astraAstraAdapter.js';
import { InteractionRouter } from './interactions/router.js';
import { Logger } from './logging/logger.js';
import { EnvironmentDiscovery } from './observe/environmentDiscovery.js';
import { ObservationWorkflow } from './observe/workflow.js';
import { TaskManager } from './orchestrator/taskManager.js';
import { ReportGenerator } from './reports/generator.js';
import { OperatorNotifier } from './reports/notifier.js';
import { SafetyGate } from './safety/safetyGate.js';
import { SCENARIO_CATALOG } from './scenarios/catalog/index.js';
import { ScenarioEngine } from './scenarios/engine.js';
import { TestPlanner } from './scenarios/planner.js';
import { RateLimitAwareExecutor } from './utils/rateLimiter.js';

/**
 * Creates and wires a complete Tanveer Ka Beta Newker application instance.
 */
export function createPlatformApp({
  env = null,
  config = null,
  discordClient = null,
  loggerSink = null,
  faultInjector = null,
  requireDiscordCredentials = false
} = {}) {
  const validatedConfig =
    config ||
    loadConfig({
      env,
      strict: true,
      requireDiscordCredentials
    });

  const explicitSecrets = [
    validatedConfig.discordToken,
    validatedConfig.telemetryWebhook?.secret
  ].filter(Boolean);

  const logger = new Logger({
    level: validatedConfig.logLevel,
    explicitSecrets,
    sink: loggerSink,
    context: { app: validatedConfig.appName }
  });

  const db = new DatabaseManager({
    databasePath: validatedConfig.databasePath,
    logger: logger.child({ component: 'sqlite' })
  });
  db.open();
  const migrationSummary = db.runMigrations();
  const integritySummary = db.checkIntegrity();
  if (!integritySummary.healthy) {
    db.close();
    throw new Error(
      `SQLite database failed startup integrity verification: ${integritySummary.integrityStatus}`
    );
  }

  const repositories = new PlatformRepositories(db);
  repositories.recordConfigSnapshot(sanitizeConfigForDisplay(validatedConfig));
  repositories.syncScenarioDefinitions(SCENARIO_CATALOG);
  repositories.applyRetentionPolicy(validatedConfig.dataRetentionDays);

  const taskManager = new TaskManager({
    repositories,
    logger: logger.child({ component: 'task-manager' }),
    maxConcurrentScenarios: validatedConfig.maxConcurrentScenarios,
    maxObservationDurationMs: validatedConfig.maxObservationDurationMs
  });
  const startupHygiene = taskManager.reconcileInterruptedRunsOnStartup();

  const client =
    discordClient ||
    new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
      ],
      partials: [Partials.Channel]
    });

  const rateLimiter = new RateLimitAwareExecutor({
    logger: logger.child({ component: 'rate-limiter' })
  });

  const astraAdapter = new AstraAstraAdapter({
    config: validatedConfig,
    logger: logger.child({ component: 'astra-adapter' })
  });

  const evidenceStore = new EvidenceStore({
    repositories,
    explicitSecrets,
    logger: logger.child({ component: 'evidence-store' })
  });

  const safetyGate = new SafetyGate({
    config: validatedConfig,
    taskManager,
    logger: logger.child({ component: 'safety-gate' })
  });

  const environmentDiscovery = new EnvironmentDiscovery({
    config: validatedConfig,
    db,
    astraAdapter,
    evidenceStore,
    discordClient: client,
    logger: logger.child({ component: 'discovery' })
  });

  const planner = new TestPlanner({
    config: validatedConfig,
    repositories,
    logger: logger.child({ component: 'planner' })
  });

  const scenarioEngine = new ScenarioEngine({
    config: validatedConfig,
    db,
    repositories,
    evidenceStore,
    taskManager,
    logger: logger.child({ component: 'scenario-engine' })
  });

  const securityAnalyzer = new SecurityAnalyzer({
    repositories,
    evidenceStore,
    logger: logger.child({ component: 'security-analyzer' })
  });

  const reportGenerator = new ReportGenerator({
    repositories,
    explicitSecrets
  });

  const operatorNotifier = new OperatorNotifier({
    config: validatedConfig,
    repositories,
    discordClient: client,
    rateLimiter,
    logger: logger.child({ component: 'notifier' })
  });

  const observationWorkflow = new ObservationWorkflow({
    config: validatedConfig,
    db,
    repositories,
    taskManager,
    environmentDiscovery,
    planner,
    scenarioEngine,
    securityAnalyzer,
    safetyGate,
    reportGenerator,
    operatorNotifier,
    evidenceStore,
    logger: logger.child({ component: 'observe-workflow' }),
    faultInjector
  });

  const authGate = new AuthorizationGate({
    config: validatedConfig,
    repositories,
    logger: logger.child({ component: 'auth-gate' })
  });

  const commandRegistry = buildAuthorizedCommandRegistry(authGate);

  const context = {
    config: validatedConfig,
    logger,
    db,
    repositories,
    taskManager,
    discordClient: client,
    rateLimiter,
    astraAdapter,
    evidenceStore,
    safetyGate,
    environmentDiscovery,
    planner,
    scenarioEngine,
    securityAnalyzer,
    reportGenerator,
    operatorNotifier,
    observationWorkflow,
    authGate,
    commandRegistry
  };

  const interactionRouter = new InteractionRouter({
    authGate,
    commandRegistry,
    context,
    logger: logger.child({ component: 'interaction-router' })
  });

  if (typeof client.on === 'function') {
    client.on(Events.ClientReady, (readyClient) => {
      logger.info('Connected to Discord Gateway', {
        botTag: readyClient?.user?.tag || 'unknown',
        botId: readyClient?.user?.id || null,
        authorizedOperatorId: validatedConfig.authorizedOperatorId
      });
    });

    client.on(Events.InteractionCreate, async (interaction) => {
      await interactionRouter.handleInteraction(interaction);
    });

    client.on(Events.Error, (err) => {
      logger.error('Discord Gateway client error', { error: err.message });
    });
  }

  let shuttingDown = false;

  async function start({ connectDiscord = Boolean(validatedConfig.discordToken) } = {}) {
    await astraAdapter.startWebhookServer();

    if (connectDiscord && validatedConfig.discordToken) {
      await client.login(validatedConfig.discordToken);
    } else {
      logger.info(
        'Platform initialized in standalone/local readiness mode (set DISCORD_TOKEN to connect live Gateway)',
        {
          operatorId: validatedConfig.authorizedOperatorId,
          registeredCommands: commandRegistry.size,
          registeredScenarios: SCENARIO_CATALOG.length,
          migrations: migrationSummary.totalMigrations
        }
      );
    }

    return {
      connectedDiscord: Boolean(connectDiscord && validatedConfig.discordToken),
      commandCount: commandRegistry.size,
      scenarioCount: SCENARIO_CATALOG.length,
      integritySummary,
      startupHygiene
    };
  }

  async function shutdown(signal = 'SIGTERM') {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('Initiating graceful platform shutdown', { signal });
    try {
      await taskManager.stopAll({ reason: `Graceful shutdown (${signal})` });
    } catch (err) {
      logger.warn('Error while stopping active tasks during shutdown', { error: err.message });
    }

    try {
      await astraAdapter.stopWebhookServer();
    } catch (err) {
      logger.warn('Error stopping telemetry webhook server', { error: err.message });
    }

    try {
      if (typeof client.destroy === 'function') {
        await client.destroy();
      }
    } catch {
      // Ignore client destroy errors
    }

    db.close();
    logger.info('Graceful shutdown completed');
  }

  return {
    ...context,
    interactionRouter,
    migrationSummary,
    integritySummary,
    startupHygiene,
    start,
    shutdown
  };
}

// Direct CLI execution (`npm start` or `node src/index.js [--verify-startup]`)
const isMainModule =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const verifyOnly = process.argv.includes('--verify-startup');

  let app = null;
  try {
    app = createPlatformApp({
      requireDiscordCredentials: !verifyOnly && Boolean(process.env.REQUIRE_DISCORD_CREDENTIALS === 'true')
    });

    const registerSignal = (sig) => {
      process.once(sig, async () => {
        await app.shutdown(sig);
        process.exit(0);
      });
    };
    registerSignal('SIGINT');
    registerSignal('SIGTERM');

    await app.start({ connectDiscord: !verifyOnly && Boolean(app.config.discordToken) });

    if (verifyOnly || !app.config.discordToken) {
      if (verifyOnly) {
        await app.shutdown('VERIFY_STARTUP_COMPLETE');
        process.exit(0);
      }
    }
  } catch (fatalError) {
    process.stderr.write(`Fatal startup error: ${fatalError.message}\n`);
    if (app) {
      await app.shutdown('FATAL_STARTUP_ERROR');
    }
    process.exit(1);
  }
}
