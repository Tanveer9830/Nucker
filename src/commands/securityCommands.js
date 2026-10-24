import { SlashCommandBuilder } from 'discord.js';
import { replyEphemeral } from '../interactions/respond.js';
import { calculateTransparentSecurityScore } from '../metrics/calculator.js';
import { CREATOR_ATTRIBUTION } from '../utils/constants.js';

export const securityAssessCommand = {
  data: new SlashCommandBuilder()
    .setName('security-assess')
    .setDescription('Evaluate available persisted security evidence and target visibility.')
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName('observation_id')
        .setDescription('Optional Observation ID (defaults to latest run)')
        .setRequired(false)
    ),

  async execute(interaction, context) {
    const requestedId = interaction.options?.getString?.('observation_id') || null;
    const run = requestedId
      ? context.repositories.getObservationRun(requestedId)
      : context.repositories.getLatestObservationRun();

    if (!run) {
      await replyEphemeral(interaction, 'No observation evidence available yet. Execute `/observe`.');
      return { assessed: false };
    }

    const evidence = context.repositories.listEvidenceByObservation(run.observation_id);
    const findings = context.repositories.listFindingsByObservation(run.observation_id);
    const bySource = {};
    for (const ev of evidence) {
      bySource[ev.source_type] = (bySource[ev.source_type] || 0) + 1;
    }

    const lines = [
      `**TANVEER KA BETA NEWKER — EVIDENCE SECURITY ASSESSMENT (\`${run.observation_id}\`)**`,
      `- **Overall Status:** \`${run.overall_status}\``,
      `- **Integration Status:** \`${run.integration_status}\``,
      `- **Target Identification:** \`${run.target_identification_state}\``,
      `- **Total Persisted Evidence Items:** ${evidence.length}`,
      `- **Total Findings Recorded:** ${findings.length}`,
      '',
      '**Evidence Sources (Strictly Separated):**'
    ];

    for (const [src, cnt] of Object.entries(bySource)) {
      lines.push(`- ${src}: **${cnt}**`);
    }
    if (evidence.length === 0) {
      lines.push('- None');
    }

    lines.push('', `_${CREATOR_ATTRIBUTION}_`);
    await replyEphemeral(interaction, lines.join('\n'));
    return { assessed: true, observationId: run.observation_id, evidenceCount: evidence.length };
  }
};

export const securityScoreCommand = {
  data: new SlashCommandBuilder()
    .setName('security-score')
    .setDescription('Display a transparent, formula-backed defensive evaluation score.')
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName('observation_id')
        .setDescription('Optional Observation ID (defaults to latest run)')
        .setRequired(false)
    ),

  async execute(interaction, context) {
    const requestedId = interaction.options?.getString?.('observation_id') || null;
    const run = requestedId
      ? context.repositories.getObservationRun(requestedId)
      : context.repositories.getLatestObservationRun();

    if (!run) {
      await replyEphemeral(interaction, 'No completed observation metrics available for scoring.');
      return { status: 'NO_DATA' };
    }

    const score = calculateTransparentSecurityScore(run.metrics);
    const lines = [
      `**TANVEER KA BETA NEWKER — TRANSPARENT SECURITY SCORE (\`${run.observation_id}\`)**`,
      `- **Scoring Status:** \`${score.status}\``,
      `- **Astra Astra Target Defense Score:** ${
        score.targetDefenseScore !== null ? `**${score.targetDefenseScore} / 100**` : '`UNVERIFIED (Withheld — Missing Target Telemetry)`'
      }`,
      `- **Platform Internal Reliability Pass Rate:** ${
        score.platformReliabilityScore !== null ? `${score.platformReliabilityScore}%` : 'N/A'
      }`,
      `- **Explanation:** ${score.explanation}`
    ];

    if (score.formula) {
      lines.push(`- **Formula:** \`${score.formula}\``);
    }

    if (score.components.length > 0) {
      lines.push('', '**Component Breakdown:**');
      for (const comp of score.components) {
        lines.push(
          `- **${comp.name}** (weight=${comp.weight}): ${
            comp.score !== null ? `${comp.score}` : 'UNAVAILABLE'
          }`
        );
      }
    }

    lines.push('', `_${CREATOR_ATTRIBUTION}_`);
    await replyEphemeral(interaction, lines.join('\n'));
    return score;
  }
};

export const securityFindingsCommand = {
  data: new SlashCommandBuilder()
    .setName('security-findings')
    .setDescription('Show confirmed defects, suspected weaknesses, and informational observations.')
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName('observation_id')
        .setDescription('Optional Observation ID (defaults to latest run)')
        .setRequired(false)
    ),

  async execute(interaction, context) {
    const requestedId = interaction.options?.getString?.('observation_id') || null;
    const run = requestedId
      ? context.repositories.getObservationRun(requestedId)
      : context.repositories.getLatestObservationRun();

    if (!run) {
      await replyEphemeral(interaction, 'No observation runs found.');
      return { count: 0 };
    }

    const findings = context.repositories.listFindingsByObservation(run.observation_id);
    const lines = [
      `**TANVEER KA BETA NEWKER — SECURITY FINDINGS (\`${run.observation_id}\`)**`,
      `Total Findings: **${findings.length}**`,
      ''
    ];

    if (findings.length === 0) {
      lines.push('Zero defects or weaknesses recorded for this observation.');
    } else {
      for (const f of findings) {
        lines.push(
          `### [${f.severity}] ${f.findingId} — ${f.title}\n` +
            `- **Classification:** \`${f.classification}\` | **Confidence:** \`${f.confidence}\` | **Status:** \`${f.verificationStatus}\`\n` +
            `- **Scenario:** \`${f.scenarioId}\` | **Capability:** ${f.affectedCapability}\n` +
            `- **Expected:** ${f.expectedBehavior}\n` +
            `- **Observed:** ${f.observedBehavior}\n` +
            `- **Reproduction:** ${f.reproductionProcedure}`
        );
      }
    }

    lines.push('', `_${CREATOR_ATTRIBUTION}_`);
    await replyEphemeral(interaction, lines.join('\n'));
    return { count: findings.length, observationId: run.observation_id };
  }
};

export const securityRegressionsCommand = {
  data: new SlashCommandBuilder()
    .setName('security-regressions')
    .setDescription('Display regression baseline status and detected regressions.')
    .setDefaultMemberPermissions(0),

  async execute(interaction, context) {
    const latestRun = context.repositories.getLatestObservationRun();
    const baselines = context.repositories.listBaselines(5);

    const lines = [
      '**TANVEER KA BETA NEWKER — REGRESSION TRACKING**',
      `Saved Baselines: **${baselines.length}**`
    ];

    if (!latestRun) {
      lines.push('', 'No observation runs recorded yet.');
    } else {
      const regRate = latestRun.metrics?.regressionRate;
      const regList = latestRun.metrics?.regressionsList || [];
      lines.push(`Latest Run: \`${latestRun.observation_id}\``);
      lines.push(
        `Regression Rate: ${
          regRate?.available
            ? `${regRate.percentage}% (${regRate.numerator}/${regRate.denominator})`
            : `UNAVAILABLE (${regRate?.missingReason || 'No comparable baseline'})`
        }`
      );
      if (regList.length > 0) {
        lines.push('', '**Detected Regressions:**');
        for (const r of regList) {
          lines.push(`- \`${r.scenarioId}\`: \`${r.baselineResult}\` -> \`${r.currentResult}\``);
        }
      } else {
        lines.push('', 'Zero regressions detected in latest comparable run.');
      }
    }

    lines.push('', `_${CREATOR_ATTRIBUTION}_`);
    await replyEphemeral(interaction, lines.join('\n'));
    return { baselineCount: baselines.length };
  }
};

export const securityRecommendationsCommand = {
  data: new SlashCommandBuilder()
    .setName('security-recommendations')
    .setDescription('Show actionable, evidence-linked remediation guidance.')
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName('observation_id')
        .setDescription('Optional Observation ID (defaults to latest run)')
        .setRequired(false)
    ),

  async execute(interaction, context) {
    const requestedId = interaction.options?.getString?.('observation_id') || null;
    const run = requestedId
      ? context.repositories.getObservationRun(requestedId)
      : context.repositories.getLatestObservationRun();

    if (!run) {
      await replyEphemeral(interaction, 'No observation findings available yet.');
      return { count: 0 };
    }

    const findings = context.repositories.listFindingsByObservation(run.observation_id);
    const lines = [
      `**TANVEER KA BETA NEWKER — ACTIONABLE REMEDIATION GUIDANCE (\`${run.observation_id}\`)**`,
      ''
    ];

    if (findings.length === 0) {
      lines.push('No remediation items required for this run.');
    } else {
      for (const f of findings) {
        const rec = f.recommendationDetail || {};
        const evIds = (f.evidenceReferences || []).map((e) => e.evidenceId).join(', ') || 'None';
        lines.push(
          `### ${f.findingId} (\`${f.scenarioId}\` — ${f.severity})\n` +
            `- **What Should Change:** ${rec.whatShouldChange || f.recommendedFix}\n` +
            `- **Why It Matters:** ${rec.whyItMatters || f.potentialImpact}\n` +
            `- **Supporting Evidence:** \`${evIds}\`\n` +
            `- **How to Implement:** ${rec.howToImplement || 'See scenario documentation.'}\n` +
            `- **How to Verify:** ${rec.howToVerify || `Rerun ${f.regressionTest}`}\n` +
            `- **Regression Risk:** ${rec.potentialRegressionRisk || 'Validate false-positive suite.'}\n` +
            `- **Tests to Rerun:** \`${(rec.rerunScenarios || [f.scenarioId]).join(', ')}\``
        );
      }
    }

    lines.push('', `_${CREATOR_ATTRIBUTION}_`);
    await replyEphemeral(interaction, lines.join('\n'));
    return { count: findings.length };
  }
};

export const securityOverviewCommand = {
  data: new SlashCommandBuilder()
    .setName('security')
    .setDescription('Unified security posture overview (score, findings, regressions).')
    .setDefaultMemberPermissions(0),

  async execute(interaction, context) {
    const latestRun = context.repositories.getLatestObservationRun();
    if (!latestRun) {
      await replyEphemeral(
        interaction,
        `No security observations recorded yet. Run \`/observe\` to begin.\n\n_${CREATOR_ATTRIBUTION}_`
      );
      return { hasData: false };
    }

    const findings = context.repositories.listFindingsByObservation(latestRun.observation_id);
    const score = calculateTransparentSecurityScore(latestRun.metrics);
    const defects = findings.filter((f) => f.classification === 'CONFIRMED_DEFECT').length;
    const weaknesses = findings.filter((f) => f.classification === 'SUSPECTED_WEAKNESS').length;
    const info = findings.filter((f) => f.classification === 'INFORMATIONAL_OBSERVATION').length;

    const lines = [
      `**TANVEER KA BETA NEWKER — SECURITY POSTURE OVERVIEW**`,
      `- **Latest Observation:** \`${latestRun.observation_id}\` (\`${latestRun.overall_status}\`)`,
      `- **Target Defense Score:** ${
        score.targetDefenseScore !== null ? `${score.targetDefenseScore}/100` : 'UNVERIFIED'
      }`,
      `- **Confirmed Defects:** ${defects} | **Suspected Weaknesses:** ${weaknesses} | **Informational:** ${info}`,
      '',
      'Detailed commands: `/security-assess`, `/security-score`, `/security-findings`, `/security-regressions`, `/security-recommendations`',
      '',
      `_${CREATOR_ATTRIBUTION}_`
    ];

    await replyEphemeral(interaction, lines.join('\n'));
    return { hasData: true, defects, weaknesses, info };
  }
};
