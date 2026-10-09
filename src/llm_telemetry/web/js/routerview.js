/*
 * Router tab (#130): one section per profile showing which model is
 * responsible for what, and why. Reads DATA.router (collect_router.py) and
 * DATA.router_meta. Rendered from views.render() whenever the profile picker
 * changes; the data itself refreshes hourly (systemd/llm-telemetry-router.timer).
 *
 * Imports only palette/charts/main so views.js can import it without a new
 * circular edge.
 */
import { $, esc, escA, trapFocus } from './palette.js';
import { current } from './charts.js';
import { DATA } from './main.js';

// One fixed hue per tier, so the same tier is the same colour in the chart,
// the matrix and the decision log.
export const RT_TIER_HUE = {
  trivial: 160, monitoring: 195, test: 45, automation: 28, research: 265,
  writing: 320, normal: 215, complex: 0, plan: 290,
};
export function rtHue(t){ return t in RT_TIER_HUE ? RT_TIER_HUE[t] : 220; }

// Brand marks from Simple Icons (CC0, simpleicons.org), 24x24 single-path.
// Inlined rather than fetched: the dashboard must render the same offline or
// on a server with no outbound access.
export const RT_SVG = {
  anthropic: 'M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z',
  openai: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
  googlegemini: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
  ollama: 'M16.361 10.26a.894.894 0 0 0-.558.47l-.072.148.001.207c0 .193.004.217.059.353.076.193.152.312.291.448.24.238.51.3.872.205a.86.86 0 0 0 .517-.436.752.752 0 0 0 .08-.498c-.064-.453-.33-.782-.724-.897a1.06 1.06 0 0 0-.466 0zm-9.203.005c-.305.096-.533.32-.65.639a1.187 1.187 0 0 0-.06.52c.057.309.31.59.598.667.362.095.632.033.872-.205.14-.136.215-.255.291-.448.055-.136.059-.16.059-.353l.001-.207-.072-.148a.894.894 0 0 0-.565-.472 1.02 1.02 0 0 0-.474.007Zm4.184 2c-.131.071-.223.25-.195.383.031.143.157.288.353.407.105.063.112.072.117.136.004.038-.01.146-.029.243-.02.094-.036.194-.036.222.002.074.07.195.143.253.064.052.076.054.255.059.164.005.198.001.264-.03.169-.082.212-.234.15-.525-.052-.243-.042-.28.087-.355.137-.08.281-.219.324-.314a.365.365 0 0 0-.175-.48.394.394 0 0 0-.181-.033c-.126 0-.207.03-.355.124l-.085.053-.053-.032c-.219-.13-.259-.145-.391-.143a.396.396 0 0 0-.193.032zm.39-2.195c-.373.036-.475.05-.654.086-.291.06-.68.195-.951.328-.94.46-1.589 1.226-1.787 2.114-.04.176-.045.234-.045.53 0 .294.005.357.043.524.264 1.16 1.332 2.017 2.714 2.173.3.033 1.596.033 1.896 0 1.11-.125 2.064-.727 2.493-1.571.114-.226.169-.372.22-.602.039-.167.044-.23.044-.523 0-.297-.005-.355-.045-.531-.288-1.29-1.539-2.304-3.072-2.497a6.873 6.873 0 0 0-.855-.031zm.645.937a3.283 3.283 0 0 1 1.44.514c.223.148.537.458.671.662.166.251.26.508.303.82.02.143.01.251-.043.482-.08.345-.332.705-.672.957a3.115 3.115 0 0 1-.689.348c-.382.122-.632.144-1.525.138-.582-.006-.686-.01-.853-.042-.57-.107-1.022-.334-1.35-.68-.264-.28-.385-.535-.45-.946-.03-.192.025-.509.137-.776.136-.326.488-.73.836-.963.403-.269.934-.46 1.422-.512.187-.02.586-.02.773-.002zm-5.503-11a1.653 1.653 0 0 0-.683.298C5.617.74 5.173 1.666 4.985 2.819c-.07.436-.119 1.04-.119 1.503 0 .544.064 1.24.155 1.721.02.107.031.202.023.208a8.12 8.12 0 0 1-.187.152 5.324 5.324 0 0 0-.949 1.02 5.49 5.49 0 0 0-.94 2.339 6.625 6.625 0 0 0-.023 1.357c.091.78.325 1.438.727 2.04l.13.195-.037.064c-.269.452-.498 1.105-.605 1.732-.084.496-.095.629-.095 1.294 0 .67.009.803.088 1.266.095.555.288 1.143.503 1.534.071.128.243.393.264.407.007.003-.014.067-.046.141a7.405 7.405 0 0 0-.548 1.873c-.062.417-.071.552-.071.991 0 .56.031.832.148 1.279L3.42 24h1.478l-.05-.091c-.297-.552-.325-1.575-.068-2.597.117-.472.25-.819.498-1.296l.148-.29v-.177c0-.165-.003-.184-.057-.293a.915.915 0 0 0-.194-.25 1.74 1.74 0 0 1-.385-.543c-.424-.92-.506-2.286-.208-3.451.124-.486.329-.918.544-1.154a.787.787 0 0 0 .223-.531c0-.195-.07-.355-.224-.522a3.136 3.136 0 0 1-.817-1.729c-.14-.96.114-2.005.69-2.834.563-.814 1.353-1.336 2.237-1.475.199-.033.57-.028.776.01.226.04.367.028.512-.041.179-.085.268-.19.374-.431.093-.215.165-.333.36-.576.234-.29.46-.489.822-.729.413-.27.884-.467 1.352-.561.17-.035.25-.04.569-.04.319 0 .398.005.569.04a4.07 4.07 0 0 1 1.914.997c.117.109.398.457.488.602.034.057.095.177.132.267.105.241.195.346.374.43.14.068.286.082.503.045.343-.058.607-.053.943.016 1.144.23 2.14 1.173 2.581 2.437.385 1.108.276 2.267-.296 3.153-.097.15-.193.27-.333.419-.301.322-.301.722-.001 1.053.493.539.801 1.866.708 3.036-.062.772-.26 1.463-.533 1.854a2.096 2.096 0 0 1-.224.258.916.916 0 0 0-.194.25c-.054.109-.057.128-.057.293v.178l.148.29c.248.476.38.823.498 1.295.253 1.008.231 2.01-.059 2.581a.845.845 0 0 0-.044.098c0 .006.329.009.732.009h.73l.02-.074.036-.134c.019-.076.057-.3.088-.516.029-.217.029-1.016 0-1.258-.11-.875-.295-1.57-.597-2.226-.032-.074-.053-.138-.046-.141.008-.005.057-.074.108-.152.376-.569.607-1.284.724-2.228.031-.26.031-1.378 0-1.628-.083-.645-.182-1.082-.348-1.525a6.083 6.083 0 0 0-.329-.7l-.038-.064.131-.194c.402-.604.636-1.262.727-2.04a6.625 6.625 0 0 0-.024-1.358 5.512 5.512 0 0 0-.939-2.339 5.325 5.325 0 0 0-.95-1.02 8.097 8.097 0 0 1-.186-.152.692.692 0 0 1 .023-.208c.208-1.087.201-2.443-.017-3.503-.19-.924-.535-1.658-.98-2.082-.354-.338-.716-.482-1.15-.455-.996.059-1.8 1.205-2.116 3.01a6.805 6.805 0 0 0-.097.726c0 .036-.007.066-.015.066a.96.96 0 0 1-.149-.078A4.857 4.857 0 0 0 12 3.03c-.832 0-1.687.243-2.456.698a.958.958 0 0 1-.148.078c-.008 0-.015-.03-.015-.066a6.71 6.71 0 0 0-.097-.725C8.997 1.392 8.337.319 7.46.048a2.096 2.096 0 0 0-.585-.041Zm.293 1.402c.248.197.523.759.682 1.388.03.113.06.244.069.292.007.047.026.152.041.233.067.365.098.76.102 1.24l.002.475-.12.175-.118.178h-.278c-.324 0-.646.041-.954.124l-.238.06c-.033.007-.038-.003-.057-.144a8.438 8.438 0 0 1 .016-2.323c.124-.788.413-1.501.696-1.711.067-.05.079-.049.157.013zm9.825-.012c.17.126.358.46.498.888.28.854.36 2.028.212 3.145-.019.14-.024.151-.057.144l-.238-.06a3.693 3.693 0 0 0-.954-.124h-.278l-.119-.178-.119-.175.002-.474c.004-.669.066-1.19.214-1.772.157-.623.434-1.185.68-1.382.078-.062.09-.063.159-.012z',
  openrouter: 'M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z',
  githubcopilot: 'M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z',
  opencode: 'M22 24H2V0h20zM17 4.8H7v14.4h10z',
  deepseek: 'M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45',
};
// Provider marks: a brand path when Simple Icons has one, else a monogram tile.
export const RT_LOGO = {
  'anthropic':    {svg:'anthropic',     mono:'A',  c:'#d97757', name:'Anthropic'},
  'openai-codex': {svg:'openai',        mono:'◉',  c:'#10a37f', name:'OpenAI (ChatGPT sign-in)'},
  'openai':       {svg:'openai',        mono:'◉',  c:'#10a37f', name:'OpenAI'},
  'gemini':       {svg:'googlegemini',  mono:'G',  c:'#4f8df5', name:'Google Gemini'},
  'local':        {svg:'ollama',        mono:'▣',  c:'#5b9cf6', name:'Self-hosted (Ollama)'},
  'ollama-cloud': {svg:'ollama',        mono:'☁',  c:'#38bdf8', name:'Ollama Cloud'},
  'openrouter':   {svg:'openrouter',    mono:'OR', c:'#8b5cf6', name:'OpenRouter'},
  'copilot':      {svg:'githubcopilot', mono:'GH', c:'#a3a3a3', name:'GitHub Copilot'},
  'opencode-go':  {svg:'opencode',      mono:'OC', c:'#7c6cf2', name:'OpenCode Go'},
  'deepseek':     {svg:'deepseek',      mono:'DS', c:'#4d6bfe', name:'DeepSeek'},
  'nous':         {svg:'',              mono:'N',  c:'#eab308', name:'Nous Portal'},
  'fireworks':    {svg:'',              mono:'FW', c:'#ff663d', name:'Fireworks'},
  'moa':          {svg:'',              mono:'⬡',  c:'#f472b6', name:'Mixture of agents'},
};
export function rtLogo(prov, size){
  const s = RT_LOGO[prov] || {svg:'', mono:(prov || '?').slice(0, 2).toUpperCase(), c:'#8b98ab', name:prov || 'unknown'};
  const px = size || 18;
  const d = s.svg && RT_SVG[s.svg];
  const mark = d
    ? `<svg class="rt-logo-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`
    : `<span class="rt-mono">${esc(s.mono)}</span>`;
  return `<span class="rt-logo" title="${escA(s.name)}" role="img" aria-label="${escA(s.name)}" style="--c:${s.c};--px:${px}px">${mark}</span>`;
}

// "model" + its provider mark + how many router decisions it took this week.
export function rtModel(e, hits){
  if (!e || !e.model) return '<span class="muted">—</span>';
  const n = hits ? (hits[`${e.model}@${e.provider}`] || 0) : 0;
  return `<span class="rt-model" title="${escA(`${e.model} via ${e.provider}${e.url ? ' · ' + e.url : ''}`)}">` +
    `${rtLogo(e.prov)}<span class="rt-mname">${esc(e.model)}</span>` +
    `<span class="rt-slot">${esc(e.provider)}</span>` +
    (n ? `<span class="rt-hits" title="router decisions in the window">${n}×</span>` : '') + '</span>';
}

export const RT_AUTH = {
  oauth:   {t:'OAuth',     cls:'ok'},
  api_key: {t:'API key',   cls:'ok'},
  mixed:   {t:'OAuth + key', cls:'ok'},
  none:    {t:'No auth',   cls:'mute'},
  unknown: {t:'No credential', cls:'bad'},
};
export function rtAuthBadge(a){
  if (!a) return '';
  const s = RT_AUTH[a.type] || RT_AUTH.unknown;
  return `<span class="rt-auth rt-${s.cls}">${esc(s.t)}</span>`;
}
export function rtStatus(st){
  if (!st) return '';
  const cls = st === 'ok' ? 'ok' : (st === 'dead' || st === 'revoked') ? 'bad' : 'warn';
  return `<span class="rt-st rt-${cls}">${esc(st)}</span>`;
}
export function rtAgo(ts){
  if (!ts) return '';
  const s = Math.max(0, Date.now() / 1000 - ts);
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)}m ago`
    : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
}
export function rtTierChip(t, extra){
  return `<span class="rt-tier" style="--h:${rtHue(t)}">${esc(t)}${extra || ''}</span>`;
}

// The turn's journey through the router, as one horizontal strip.
export function rtFlowStrip(tr){
  const cl = tr.classifier || {};
  const steps = [
    ['💬', 'You send a turn', 'every user message'],
    ['🏷', 'Classifier labels it', `“category level” · ${(cl.pool || []).length} models, ${cl.timeout_s || '?'}s budget`],
    ['🧭', 'Matrix picks a tier', `default: ${tr.default_tier}`],
    ['⚙', 'Tier pool runs it', 'round-robin or priority'],
    ['↯', 'Unhealthy? fall back, then escalate', `${tr.cooldown_s || '?'}s cooldown per model`],
    ['↩', tr.restore_primary ? 'Primary restored' : 'Stays on tier model', tr.restore_primary ? 'router re-decides next turn' : 'until a new decision'],
  ];
  return '<div class="rt-strip">' + steps.map(([i, t, s], k) =>
    `${k ? '<span class="rt-arrow" aria-hidden="true">→</span>' : ''}` +
    `<div class="rt-step"><span class="rt-step-ico" aria-hidden="true">${i}</span>` +
    `<b>${esc(t)}</b><span class="muted">${esc(s)}</span></div>`).join('') + '</div>';
}

// The responsibility chart: primary on top, classifier under it, one card per
// tier fanning out, each saying what it handles and who runs it.
export function rtChart(p){
  const tr = p.tier_router, dec = p.decisions || {}, hits = dec.by_model || {};
  const byTier = dec.by_tier || {}, total = dec.total || 0;
  const auth = p.auth || {};
  const prim = p.primary || {};
  const head = `<div class="rt-org">
    <div class="rt-node rt-primary">
      <div class="rt-role">Primary · orchestrator</div>
      ${rtModel(prim)}
      <div class="rt-meta">${prim.effort ? `effort ${esc(prim.effort)} · ` : ''}${rtAuthBadge(auth[prim.provider])}</div>
      <div class="rt-meta muted">Configured main model. ${tr && tr.enabled ? (tr.restore_primary ? 'The router swaps a tier model in per turn, then restores this one.' : 'The router swaps a tier model in per turn.') : 'Handles every turn — the router is off.'}</div>
    </div>
    <div class="rt-vline" aria-hidden="true"></div>
    <div class="rt-node rt-classifier">
      <div class="rt-role">Tier classifier</div>
      <div class="rt-models">${(tr.classifier.pool || []).map(e => rtModel(e)).join('')}</div>
      <div class="rt-meta muted">Reads the last ${tr.classifier.history_turns || '?'} turns and answers “category level”. First healthy model wins.</div>
    </div>
    <div class="rt-vline" aria-hidden="true"></div>
  </div>`;
  const cards = tr.tiers.map(t => {
    const n = byTier[t.name] || 0;
    const pct = total ? Math.round(100 * n / total) : 0;
    const why = t.why.length
      ? t.why.map(w => `<span class="rt-why">${esc(w.category)} · ${esc(w.level)}</span>`).join('')
      : '<span class="muted">no route lands here directly</span>';
    return `<div class="rt-tcard" style="--h:${rtHue(t.name)}" data-tier="${escA(t.name)}">
      <div class="rt-thead">${rtTierChip(t.name)}
        <span class="rt-mode" title="${t.mode === 'priority' ? 'strict order: first healthy model' : 'spread turns across the pool'}">${esc(t.mode === 'round_robin' ? 'round-robin' : t.mode)}</span>
        ${t.name === tr.default_tier ? '<span class="rt-default" title="used when the classifier gives no answer">default</span>' : ''}
        <span class="rt-share" title="${n} of ${total} decisions in the window">${n ? `${pct}%` : '0'}</span>
      </div>
      <div class="rt-bar"><i style="width:${pct}%"></i></div>
      <div class="rt-doc">${esc(t.doc)}</div>
      <div class="rt-sub">Handles</div><div class="rt-whys">${why}</div>
      <div class="rt-sub">Pool (${t.pool.length})</div>
      <div class="rt-models">${t.pool.map(e => rtModel(e, hits)).join('')}</div>
      <div class="rt-foot">
        ${t.escalate_to ? `<span title="when every pool and fallback model is down">escalates → ${rtTierChip(t.escalate_to)}</span>` : '<span class="muted">top of ladder</span>'}
        ${t.fallback.length ? `<details class="rt-fb"><summary>${t.fallback.length} fallbacks</summary><div class="rt-models">${t.fallback.map(e => rtModel(e, hits)).join('')}</div></details>` : ''}
      </div>
    </div>`;
  }).join('');
  return head + `<div class="rt-tiers">${cards}</div>`;
}

// category x level -> tier, with how often the classifier actually said it.
export function rtMatrix(p, vocab){
  const tr = p.tier_router, routes = tr.routes || {};
  const cats = vocab.categories || Object.keys(routes);
  const lvls = vocab.levels || ['easy', 'medium', 'hard'];
  const byRoute = (p.decisions || {}).by_route || {};
  const custom = new Set(tr.custom_routes || []);
  const cdoc = vocab.category_doc || {}, ldoc = vocab.level_doc || {};
  return `<table class="rt-matrix"><thead><tr><th></th>${lvls.map(l =>
    `<th title="${escA(ldoc[l] || '')}">${esc(l)}</th>`).join('')}</tr></thead><tbody>` +
    cats.map(c => `<tr><th title="${escA(cdoc[c] || '')}">${esc(c)}</th>${lvls.map(l => {
      const t = (routes[c] || {})[l]; const n = byRoute[`${c}/${l}`] || 0;
      return `<td>${t ? rtTierChip(t, custom.has(`${c}/${l}`) ? '<sup title="overridden in this profile\'s config">*</sup>' : '') : '—'}` +
        `${n ? `<span class="rt-n" title="classifier said “${escA(c)} ${escA(l)}” ${n}× in the window">${n}</span>` : ''}</td>`;
    }).join('')}</tr>`).join('') + '</tbody></table>';
}

// Everything that is NOT the conversation: auxiliary tasks, subagents, MoA.
export function rtWorkers(p){
  const auth = p.auth || {};
  const rows = (p.tasks || []).map(t => [t.task, t, t.doc, t.fallbacks]);
  if (p.delegation) rows.push(['delegation', p.delegation,
    `Subagents (up to ${p.delegation.max_children || '?'} at once).`, p.delegation.fallbacks]);
  if (p.moa) rows.push(['mixture of agents', p.moa.agg,
    `Aggregates ${p.moa.refs.length} reference models${p.moa.fanout ? ` (${p.moa.fanout})` : ''}.`, 0]);
  if (!rows.length) return '<div class="muted">No background tasks configured.</div>';
  return '<div class="rt-workers">' + rows.map(([name, e, doc, fb]) =>
    `<div class="rt-worker"><div class="rt-role">${esc(name.replace(/_/g, ' '))}</div>${rtModel(e)}
      <div class="rt-meta">${rtAuthBadge(auth[e && e.provider])}${fb ? ` <span class="muted">+${fb} fallbacks</span>` : ''}</div>
      <div class="rt-meta muted">${esc(doc || '')}</div></div>`).join('') + '</div>';
}

export function rtAuthTable(p){
  const auth = p.auth || {};
  const slots = Object.keys(auth);
  if (!slots.length) return '<div class="muted">No providers.</div>';
  // How many distinct models this profile can send to each slot.
  const models = {};
  const add = e => { if (e && e.provider) (models[e.provider] = models[e.provider] || new Set()).add(e.model); };
  [p.primary, ...(p.chain || []), ...(p.tasks || []), p.delegation].forEach(add);
  const tr = p.tier_router;
  if (tr) { tr.classifier.pool.forEach(add); tr.tiers.forEach(t => { t.pool.forEach(add); t.fallback.forEach(add); }); }
  return `<table class="rt-authtbl"><thead><tr><th>Provider</th><th>Auth</th><th>Credential</th><th>Models</th></tr></thead><tbody>` +
    slots.map(s => {
      const a = auth[s];
      const creds = a.creds.length
        ? a.creds.map(c => `<div class="rt-cred"><span class="rt-credlbl">${esc(c.label || c.source)}</span>` +
            `<span class="muted">${esc(c.auth_type === 'oauth' ? 'OAuth' : 'API key')} · ${esc(c.source)}</span>${rtStatus(c.last_status)}</div>`).join('')
        : `<span class="muted">${esc(a.note)}</span>`;
      return `<tr data-slot="${escA(s)}"><td>${rtLogo(a.prov, 20)} <b>${esc(s)}</b>${s !== a.prov ? ` <span class="muted">${esc(a.prov)}</span>` : ''}</td>` +
        `<td>${rtAuthBadge(a)}</td><td>${creds}</td><td>${models[s] ? models[s].size : 0}</td></tr>`;
    }).join('') + '</tbody></table>' +
    '<div class="rt-note muted">Only the credential’s type, source and pool status are shown. Keys and tokens never leave the server; emails are masked.</div>';
}

export function rtDecisions(p){
  const d = p.decisions;
  if (!d) return '<div class="muted">No agent log found for this profile.</div>';
  const fails = Object.entries(d.classifier_failures || {}).sort((a, b) => b[1] - a[1]);
  const kpi = (v, l, bad) => `<div class="rt-kpi${bad && v ? ' rt-kbad' : ''}"><b>${v}</b><span>${esc(l)}</span></div>`;
  return `<div class="rt-kpis">${kpi(d.total, 'decisions')}${kpi(d.escalations, 'escalated')}` +
    `${kpi(d.defaulted, 'default tier (no label)', true)}${kpi(d.failed_open, 'router failed open', true)}` +
    `${kpi(d.budget_exhausted, 'classifier budget out', true)}</div>` +
    (fails.length ? `<div class="rt-meta">Classifier failures: ${fails.map(([m, n]) => `<span class="rt-why">${esc(m)} ×${n}</span>`).join('')}</div>` : '') +
    (d.recent.length ? `<table class="rt-recent"><thead><tr><th>When</th><th>Why</th><th>Tier</th><th>Model</th></tr></thead><tbody>` +
      d.recent.map(r => `<tr><td class="muted" title="${escA(new Date(r.ts * 1000).toLocaleString())}">${esc(rtAgo(r.ts))}</td>` +
        `<td>${esc(r.reason.replace(/^classifier:/, '').replace('/', ' · '))}</td>` +
        `<td>${rtTierChip(r.tier)}${r.used !== r.tier ? ` → ${rtTierChip(r.used)}` : ''}</td>` +
        `<td>${rtModel({model: r.model, provider: r.prov, prov: r.prov})}</td></tr>`).join('') + '</tbody></table>'
      : `<div class="muted">No routing decisions in the last ${d.window_days} days.</div>`);
}

// The tab is split into sub-pages (#130) because one profile's router picture
// is six dense cards and a fleet-wide view stacked all of them. Each page is a
// question you actually arrive with; the strip is inside the view because the
// left nav is section-level and these are not sections.
export const RT_PAGES = [
  ['overview', 'Overview', 'How a turn is routed, and which model owns what'],
  ['matrix', 'Matrix', 'Category x level to tier, with real classifier counts'],
  ['decisions', 'Decisions', 'What the router actually did, from the agent log'],
  ['workers', 'Workers', 'Background tasks, subagents and MoA'],
  ['providers', 'Providers', 'Credential type, source and pool status per slot'],
];
export const RT_PAGE_KEY = 'hermes-dash-router-page';
export function rtPageGet(){
  try {
    const p = localStorage.getItem(RT_PAGE_KEY);
    return RT_PAGES.some(([id]) => id === p) ? p : 'overview';
  } catch { return 'overview'; }
}
export let rtPage = rtPageGet();
export function rtPageSet(id){
  if (!RT_PAGES.some(([p]) => p === id) || id === rtPage) return;
  rtPage = id;
  try { localStorage.setItem(RT_PAGE_KEY, id); } catch { /* private mode */ }
  renderRouterView();
}

// Collapsed sections persist per browser: a key is "<profile>|<card>", so
// folding the auth table on one profile does not fold it on another.
export const RT_FOLD_KEY = 'hermes-dash-router-folded';
export function rtFolded(){
  try { return new Set(JSON.parse(localStorage.getItem(RT_FOLD_KEY) || '[]')); }
  catch { return new Set(); }
}
export function rtSaveFold(key, open){
  const s = rtFolded();
  if (open) s.delete(key); else s.add(key);
  try { localStorage.setItem(RT_FOLD_KEY, JSON.stringify([...s])); } catch { /* private mode */ }
}

export function rtSection(name, p, vocab){
  const tr = p.tier_router;
  const on = tr && tr.enabled;
  const folded = rtFolded();
  // Every card is a <details>: native keyboard + screen-reader support, and
  // the summary keeps the title and subtitle visible while folded.
  const card = (id, title, sub, body) => {
    const key = `${name}|${id}`;
    return `<details class="card rt-card" data-rtfold="${escA(key)}"${folded.has(key) ? '' : ' open'}>` +
      `<summary class="lbl">${esc(title)}${sub ? ` <span class="muted rt-lblsub">${esc(sub)}</span>` : ''}</summary>` +
      `<div class="rt-cbody">${body}</div></details>`;
  };
  // Only the selected sub-page's cards are built. A profile with the router off
  // has no matrix/decisions to show, so those pages fall back to its model
  // chain rather than rendering an empty grid that reads like a bug — except
  // Providers, which every profile has.
  const dw = (p.decisions || {}).window_days || 7;
  const chainCard = () => {
    const chain = [p.primary, ...(p.chain || [])];
    return card('chain', 'Model chain', tr ? 'tier router configured but disabled' : 'no tier router in this profile',
      `<div class="rt-chain">${chain.map((e, i) => `${i ? '<span class="rt-arrow" aria-hidden="true">↓</span>' : ''}` +
        `<div class="rt-hop"><span class="rt-role">${i ? `fallback ${i}` : 'primary'}</span>${rtModel(e)}${rtAuthBadge((p.auth || {})[e.provider])}</div>`).join('')}</div>`);
  };
  const PAGES = {
    overview: () => on
      ? card('flow', 'How a turn is routed', '', rtFlowStrip(tr)) +
        card('chart', 'Model responsibility chart', `share = router decisions, last ${dw} days`, rtChart(p))
      : chainCard(),
    matrix: () => on
      ? card('matrix', 'Routing matrix', 'category × level → tier', rtMatrix(p, vocab))
      : chainCard(),
    decisions: () => on
      ? card('decisions', 'Routing decisions', `from the agent log, last ${dw} days`, rtDecisions(p))
      : chainCard(),
    workers: () => card('workers', 'Background workers', 'auxiliary tasks, subagents, MoA', rtWorkers(p)),
    providers: () => card('auth', 'Providers & auth', 'how each provider slot authenticates', rtAuthTable(p)),
  };
  const body = (PAGES[rtPage] || PAGES.overview)();
  const pkey = `${name}|*`;
  return `<details class="rt-profile" data-profile="${escA(name)}" data-rtfold="${escA(pkey)}"${folded.has(pkey) ? '' : ' open'}>
    <summary class="rt-phead"><h2>${esc(name)}</h2>
      <span class="rt-auth ${on ? 'rt-ok' : 'rt-mute'}">${on ? 'router on' : 'router off'}</span>
      ${on ? `<span class="muted">${tr.tiers.length} tiers · default ${esc(tr.default_tier)}</span>` : ''}
      <span class="rt-foldall"><button type="button" data-rtall="open">expand all</button><button type="button" data-rtall="close">collapse all</button></span>
    </summary>${body}</details>`;
}

// Home card stat: tiers + decisions for one profile, routed/total for All.
export function routerStat(){
  const all = DATA.router || {};
  const names = (current && current !== 'All' && all[current]) ? [current] : Object.keys(all);
  if (!names.length) return 'No data';
  const on = names.filter(n => (all[n].tier_router || {}).enabled);
  if (names.length === 1) {
    const p = all[names[0]];
    return on.length ? `${p.tier_router.tiers.length} tiers \u00b7 ${(p.decisions || {}).total || 0} decisions` : 'router off';
  }
  return `${on.length}/${names.length} profiles routed`;
}

export function renderRouterView(){
  const el = $('routerview');
  if (!el) return;
  const all = DATA.router || {};
  const meta = DATA.router_meta || {};
  const vocab = meta.vocab || {};
  const every = Object.keys(all).sort();
  // The global profile picker drives the tab; "All" (when a build has it) or a
  // profile with no router data shows every profile stacked.
  const names = (current && all[current]) ? [current] : every;
  const sub = $('routersub');
  if (sub) sub.textContent = meta.collected_at
    ? `refreshed hourly · last ${rtAgo(meta.collected_at)}` : 'refreshed hourly';
  if (!names.length) { el.innerHTML = '<div class="card rt-card muted">No router data — run <code>llm-telemetry router</code>.</div>'; return; }
  // No profile switcher here: the header chip strip already switches profile,
  // and a second one mid-page invited the wrong click. What the tab needs is a
  // way through its OWN content, so the strip picks a sub-page — one question
  // per page instead of six dense cards stacked per profile.
  const strip = `<nav class="rt-pages" aria-label="Router pages">${RT_PAGES.map(([id, label, tip]) => {
    const on = id === rtPage;
    return `<button type="button" data-rtpage="${escA(id)}"${on ? ' aria-current="page"' : ''}` +
      ` title="${escA(tip)}" class="rt-page${on ? ' rt-page-on' : ''}">${esc(label)}</button>`;
  }).join('')}</nav>`;
  el.innerHTML = strip + names.map(n => rtSection(n, all[n], vocab)).join('');
  el.querySelectorAll('details[data-rtfold]').forEach(dt => dt.addEventListener('toggle', () => rtSaveFold(dt.dataset.rtfold, dt.open)));
  el.querySelectorAll('[data-rtall]').forEach(b => b.addEventListener('click', ev => {
    ev.preventDefault(); ev.stopPropagation();   // inside <summary>: don't fold the profile
    const open = b.dataset.rtall === 'open';
    b.closest('.rt-profile').querySelectorAll('details.rt-card').forEach(dt => { dt.open = open; rtSaveFold(dt.dataset.rtfold, open); });
  }));
  el.querySelectorAll('[data-rtpage]').forEach(b => b.addEventListener('click', () => rtPageSet(b.dataset.rtpage)));
}


// ---- Router help overlay (#146) -----------------------------------------
// #helpwrap shipped in the HTML with a scrim, a close button and no wiring at
// all: #helpbtn did nothing. This is the one install it needed — open, Tab
// trap, Esc, click-out, restore focus to the "?" button.
export let helpOpen = false, helpTrap = null;

export function helpKeydown(e){
  if (e.key === 'Escape'){ e.preventDefault(); helpSetOpen(false); }
}

export function helpSetOpen(on){
  if (on === helpOpen) return;
  helpOpen = on;
  $('helpwrap')?.classList.toggle('open', on);
  if (on){
    // Content is rendered per open so the profile line is current; the panel
    // itself stays a static body child (fixed positioning, like the drawer).
    if ($('helpprof')) $('helpprof').textContent = (DATA.router_meta || {}).collected_at
      ? 'One section per profile · refreshed hourly' : 'One section per profile';
    helpTrap = trapFocus($('helpwrap'), $('helpscrim'), helpKeydown);
  } else {
    helpTrap?.release();
    helpTrap = null;
  }
}

let helpInstalled = false;
export function installHelp(){
  if (helpInstalled) return;
  helpInstalled = true;
  $('helpbtn')?.addEventListener('click', () => helpSetOpen(true));
  $('helpclose')?.addEventListener('click', () => helpSetOpen(false));
  $('helpscrim')?.addEventListener('click', () => helpSetOpen(false));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && helpOpen) helpSetOpen(false);
  });
}
