// Faz o papel do Claude Code no teste do caminho real do executor: lê o prompt da entrada padrão e responde no mesmo
// protocolo stream-json (uso da conta, eventos de texto e resultado). Nenhum modelo é chamado.
let entrada = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { entrada += d; });
process.stdin.on('end', () => {
  const diga = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const texto = /Responda só: (\w+)/.exec(entrada)?.[1] || 'ok';
  diga({ type: 'system', subtype: 'init', tools: [], agents: [] });
  diga({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.12, resetsAt: Math.floor(Date.now() / 1000) + 3600 } } } });
  diga({ type: 'stream_event', event: { type: 'message_start' } });
  diga({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });
  diga({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: texto } } });
  diga({ type: 'result', result: texto, is_error: false, duration_ms: 5, total_cost_usd: 0, usage: { input_tokens: 10, output_tokens: 1 } });
  process.exit(0);
});
