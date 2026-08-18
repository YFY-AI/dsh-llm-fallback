export async function balanceCommand(ctx) {
  const apiKey = ctx.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      error: '❌ 未配置 DEEPSEEK_API_KEY，请先设置：\n`dsh config set DEEPSEEK_API_KEY sk-xxx`'
    };
  }

  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    const balanceInfo = data.balance_infos[0];
    const total = balanceInfo.total_balance;
    const granted = balanceInfo.granted_balance;
    const topped = balanceInfo.topped_up_balance;

    return {
      title: '💰 DeepSeek 账户余额',
      content: {
        is_available: data.is_available,
        currency: balanceInfo.currency,
        total_balance: total,
        granted_balance: granted,
        topped_up_balance: topped
      },
      markdown: `## 💰 DeepSeek 账户余额

| 项目 | 金额 |
|------|------|
| 总余额 | **${total} ${balanceInfo.currency}** |
| 赠送额度 | ${granted} ${balanceInfo.currency} |
| 充值额度 | ${topped} ${balanceInfo.currency} |

**账户状态**：${data.is_available ? '✅ 可用' : '❌ 不可用'}
*最后更新：${new Date().toLocaleString('zh-CN')}*`
    };
  } catch (err) {
    return { error: `查询失败：${err.message}` };
  }
}