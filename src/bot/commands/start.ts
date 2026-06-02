import type { CommandContext, Context } from 'grammy';

export async function startCommand(ctx: CommandContext<Context>): Promise<void> {
  await ctx.reply(
    '안녕하세요! 저는 AI 챗봇입니다. 🤖\n\n' +
    '자연어로 질문하시면 답변해드립니다.\n\n' +
    '📋 사용 가능한 명령어:\n' +
    '/menu — 빠른 질의 메뉴\n' +
    '/reset — 대화 초기화\n' +
    '/model <id> — 모델 변경\n' +
    '/models — 사용 가능한 모델 목록\n' +
    '/status — 현재 상태 확인',
  );
}
