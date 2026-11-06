import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const read = file => readFile(new URL(`../${file}`, import.meta.url));
const data = JSON.parse(await read('docs/performance-v1.1.json'));
const build = JSON.parse(await read('output/rare-build.json'));
const row = (label, old, current) => `| ${label} | ${old.medianMs} / ${old.p95Ms} | ${current.medianMs} / ${current.p95Ms} |`;
const bytes = Object.values(build.files).reduce((n, v) => n + v.bytes, 0);
const gzip = Object.values(build.files).reduce((n, v) => n + v.gzipBytes, 0);
const selected = data.interactions;
const report = `# Rare UI接入与性能对比

日期：2026-11-07（北京时间）。版本：v1.0原生卡片界面与v1.1紧凑界面。Chromium 158，同一独立测试配置，交替测量，离线、无封面网络请求。

## 结论

在本机这组测试中，接入Rare UI后没有发现启动或常用交互的明显退化。首屏不加载React或Rare UI；首次打开设置存在可测量的额外载入成本。布局也发生了变化，启动差异不能全部归因于组件库。这里没有做统计显著性推断，也不保证低性能设备有相同结果。

## 启动与设置

单位ms；每格为**中位数 / P95**。

| 场景 | v1.0 | v1.1 |
|---|---:|---:|
${row('3条缓存清单启动，各50次', data.startup[3]['1.0.0'], data.startup[3]['1.1.0'])}
${row('1000条缓存清单启动，各25次', data.startup[1000]['1.0.0'], data.startup[1000]['1.1.0'])}
${row('首次设置完整就绪，各20次', data.settings['1.0.0'].completeFirstOpen, data.settings['1.1.0'].completeFirstOpen)}
${row('设置面板同步显示，各20次', data.settings['1.0.0'].panelVisible, data.settings['1.1.0'].panelVisible)}
${row('设置再次展开处理，各20次', data.settings['1.0.0'].warmHandler, data.settings['1.1.0'].warmHandler)}

3条启动最大值：旧版${data.startup[3]['1.0.0'].maxMs}，新版${data.startup[3]['1.1.0'].maxMs}；首次设置组件挂载最大值${data.settings['1.1.0'].completeFirstOpen.maxMs}。原始离群值保留在JSON中，没有删去。

两个版本初始都仅一次storage.local.get。新版首屏Rare UI资源请求数为0，20次首次设置中均实际检测到官方Theme Selector DOM。

## 常用交互

新版每项50次：清单选择处理，中位${selected.selectionHandler.medianMs}、P95 ${selected.selectionHandler.p95Ms}；下一次动画帧回调，中位${selected.selectionNextFrame.medianMs}、P95 ${selected.selectionNextFrame.p95Ms}。书签展开再收起处理，中位${selected.bookmarkOpenCloseHandler.medianMs}、P95 ${selected.bookmarkOpenCloseHandler.p95Ms}；筛选往返处理，中位${selected.filterRoundTripHandler.medianMs}、P95 ${selected.filterRoundTripHandler.p95Ms}。

交互观察窗口内记录到${selected.observedLongTasks.length}个Long Task，页面异常${data.pageErrors.length}个。这一短窗口不等于完整内存或卡顿审计。

## 新增资源与接入证据

组件JS：${build.files['assets/rare-theme.js'].bytes} bytes，gzip ${build.files['assets/rare-theme.js'].gzipBytes} bytes；CSS：${build.files['assets/rare-theme.css'].bytes} bytes，gzip ${build.files['assets/rare-theme.css'].gzipBytes} bytes。合计约${(bytes / 1024).toFixed(1)} KiB原始文件，${(gzip / 1024).toFixed(1)} KiB gzip。这是本机分发资源体积，不是每次打开的网络下载量。

采用官方Theme Selector原始TSX，适配器直接import，构建为含React/React DOM的本机生产bundle。组件原文、提交和校验码位于vendor/rare-ui；build/check会核对，设置中有可见署名。全部依赖许可证随assets/licenses分发。

## 测量边界与复现

- 启动从页面navigation开始计到本机清单DOM就绪，不含工具栏创建popup的全部开销。
- 每次新建页面上下文，但浏览器和文件系统缓存保持热状态；不是系统冷启动测试。
- 设置首开计本机模块/CSS载入及首次React提交；面板会先同步显示占位。
- 事件处理时间排除自动化传输；动画帧回调不等于真实显示器上的物理点击延迟。
- 本轮共150次新页面启动，外加40次设置首开和交互检查。没有用这组数字声称内存零增长。

完整原始样本汇总：performance-v1.1.json；源码/安装资源哈希：source-hashes-v1.1.json。测试程序tools/popup-benchmark.js，准备步骤见README。
`;
await writeFile(new URL('../docs/PERFORMANCE.md', import.meta.url), report);
const hashes = {};
for (const file of ['popup.html', 'popup.js', 'popup.css', 'assets/rare-theme.js', 'assets/rare-theme.css', 'vendor/rare-ui/theme-selector.tsx', 'tests/baseline/bili-focus-1.0.0.zip']) hashes[file] = createHash('sha256').update(await read(file)).digest('hex');
await writeFile(new URL('../docs/source-hashes-v1.1.json', import.meta.url), JSON.stringify(hashes, null, 2));
console.log('Wrote performance report and source hashes.');
