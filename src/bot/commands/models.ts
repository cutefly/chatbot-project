import type { CommandContext, Context } from 'grammy';

const CURATED_MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-3-haiku',
  'anthropic/claude-3-5-sonnet',
  'google/gemini-flash-1.5',
  'google/gemini-pro-1.5',
  'meta-llama/llama-3.1-70b-instruct',
];

export async function modelsCommand(ctx: CommandContext<Context>): Promise<void> {
  const list = CURATED_MODELS.map(m => `• ${m}`).join('\n');
  await ctx.reply(`🤖 사용 가능한 모델:\n\n${list}\n\n변경 방법: /model <model-id>`);
}
