import { AttachmentBuilder, MessageFlags } from 'discord.js';
import { splitMarkdownForDiscord } from '../reports/notifier.js';
import { redactSecrets } from '../utils/redaction.js';

/**
 * Sends a private (ephemeral) reply to the authorized operator,
 * automatically redacting secrets and handling Discord's 2000-character message limit.
 */
export async function replyEphemeral(
  interaction,
  content,
  { components = [], files = [], explicitSecrets = [] } = {}
) {
  const safeContent = redactSecrets(String(content || ''), explicitSecrets);
  const chunks = splitMarkdownForDiscord(safeContent, 1900);
  const firstChunk = chunks[0] || 'Done.';

  const extraFiles = [...files];
  if (chunks.length > 1) {
    extraFiles.push(
      new AttachmentBuilder(Buffer.from(safeContent, 'utf8'), {
        name: 'full-response.md'
      })
    );
  }

  const payload = {
    content:
      chunks.length > 1
        ? `${firstChunk}\n\n_(Full output attached as \`full-response.md\` — ${safeContent.length} chars)_`
        : firstChunk,
    flags: MessageFlags.Ephemeral,
    ...(components.length > 0 ? { components } : {}),
    ...(extraFiles.length > 0 ? { files: extraFiles } : {})
  };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}
