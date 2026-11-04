import asyncio

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    TextBlock,
    query,
)


async def main():
    options = ClaudeAgentOptions(
        system_prompt=(
            "あなたはゲームデザイナー兼テストプレイヤーです。"
            "コードからゲームの仕様を読み取り、遊ぶ人の目線で評価してください。日本語で答えてください。"
        ),
        allowed_tools=["Read", "Glob", "Grep"],
        max_turns=10,
    )

    async for message in query(
        prompt=(
            "このフォルダのゲームを読んで、次の観点でレビューして。"
            "1. 難易度やバランス（数値設定が厳しすぎ・甘すぎないか）"
            "2. 操作性や分かりやすさ"
            "3. もっと面白くするアイデアを3つ"
            "4. 建築の種類を大幅追加し、ゲーム性にバリエーションを持たせる案"

        ),
        options=options,
    ):
        # Claudeの発言を表示
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    print(block.text)
        # 最後に結果とかかった費用を表示
        elif isinstance(message, ResultMessage):
            print("\n--- 完了 ---")
            print(f"かかった費用: ${message.total_cost_usd}")


asyncio.run(main())