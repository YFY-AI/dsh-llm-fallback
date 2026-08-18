export { balanceCommand } from './commands/balanceCommand.js';

export default {
  name: 'dsh-llm-fallback',
  version: '1.0.1',
  commands: [
    {
      name: 'llm-fallback',
      description: 'LLM 模型回替链管理',
      subcommands: [
        {
          name: 'balance',
          description: '查询当前 DeepSeek 账户余额',
          handler: 'balanceCommand'
        }
      ]
    }
  ]
};