import { readFile, writeFile, copyFile } from 'node:fs/promises';
const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const write = (name, value) => writeFile(new URL(`../${name}`, import.meta.url), value);
const p=JSON.parse(await read('docs/performance-v1.3.json')),build=JSON.parse(await read('output/rare-build.json'));
const row=(label,a,b)=>`| ${label} | ${a.medianMs} / ${a.p95Ms} | ${b.medianMs} / ${b.p95Ms} |`;
await write('docs/PERFORMANCE.md',`# v1.3 性能与Rare UI接入

2026-11-07（北京时间）。实际对比保留的v1.2.0安装包与v1.3.0；Chromium 158，独立配置、离线、无封面请求，交替打开新扩展页面，浏览器及文件缓存保持温热。

## 打开耗时

单位ms，单元格为中位数 / P95，各15次。测量导航开始到本机清单DOM就绪，不包含工具栏创建弹窗开销，也不是系统冷启动。15次样本的P95与最大值重合，未剔除离群值。

| 场景 | v1.2 | v1.3 |
|---|---:|---:|
${[3,1000,5000].map(n=>row(`${n}条清单`,p.startup[n]['1.2.0'],p.startup[n]['1.3.0'])).join('\n')}
${row('首次设置Rare UI完整挂载，各8次',p.settings['1.2.0'].firstRareMount,p.settings['1.3.0'].firstRareMount)}
${row('设置再次展开处理，各8次',p.settings['1.2.0'].reopenHandler,p.settings['1.3.0'].reopenHandler)}

新版有可测量的打开成本，约增加4.5–11.7ms中位耗时。布局、分组校验和数据处理都变了，差异不能仅归因于Rare UI。5000条P95为${p.startup[5000]['1.3.0'].p95Ms}ms，需要关注低性能设备上的实际体验。

各场景初始均只读一次本机state；初始Rare UI/React/CSS请求为0。普通清单5000条也只绘制最多6行（包含分组行），不会为所有视频创建图片和按钮。

## 长清单交互

100个分组、5层深度。搜索计时包含两个无头浏览器动画帧；选择计时为同步处理，排除自动化传输。二者都不是物理屏幕显示延迟。

| 场景 | 搜索中位 / P95 ms | 选择处理中位 / P95 ms | 滚到底部ms | 底部DOM行数 |
|---|---:|---:|---:|---:|
${[1000,5000].map(n=>{const i=p.interactions[n];return `| ${n}条 | ${i.searchToSecondFrame.medianMs} / ${i.searchToSecondFrame.p95Ms} | ${i.selectionHandler.medianMs} / ${i.selectionHandler.p95Ms} | ${i.scrollToBottomMs} | ${i.maxBottomRows} |`;}).join('\n')}

上述短交互窗口观察到0个Long Task，页面异常0；不代表已完成全面内存或长时间运行剖析。分组树遍历/计数无递归；2000层嵌套由逻辑测试覆盖。隐藏的分组下拉框不在启动时创建选项。

## 组件与体积

实际import官方ThemeSelector及ToastCard，上游TSX与锁定提交的SHA-256一致；原始来源见vendor/rare-ui/provenance.json。应用适配提供中文、主题色、固定单个反馈位置和撤销回调，保留官方预览与短暂图标/描边动画。减少动态效果偏好生效。

| 本地生成文件 | 字节 | gzip字节（参考） |
|---|---:|---:|
${Object.entries(build.files).map(([file,s])=>`| ${file} | ${s.bytes} | ${s.gzipBytes} |`).join('\n')}

两个入口共享React。上述体积增加安装包大小，并在首次使用相应功能时增加载入成本；不会在首屏全部加载。反馈原生提示立即显示，首次带撤销的提示保持按钮位置直到结束，避免载入组件时移动操作目标。无网络CDN、持续动画、粒子或背景模糊。

原始结果：performance-v1.3.json；可复现脚本：tools/library-benchmark.js。v1.1历史数据另存PERFORMANCE-v1.1.md，没有拿来替代当前结果。
`);
await write('TEST_REPORT.md',`# v1.3 验证记录

日期：2026-11-07（北京时间）。

## 已通过

- **62项逻辑测试**：原进度、分P、书签、备份、封面、颜色、手动清理规则；新增旧数据迁移、2000层分组索引与搜索、循环/无效父组拒绝、删组只移动记录及撤销、后续编辑不被撤销覆盖、名称回退、导入ID冲突映射、折叠状态、批量自定义名、刷新/重复添加保留自定义名、失败链接重试保留组名、离线短链可预览暂存、无效导入原子性、内容脚本权限隔离。
- **真实MV3清单交互**：400×520、48px主按钮、图标同高同位置、首屏0 Rare UI请求、行内编辑/删除/撤销、原标题及自定义名搜索、重开保留折叠、删整组不删视频/可撤销、新建组、实际Rare UI ToastCard与ThemeSelector。docs/library-check-v1.3.json。
- **添加交互**：醒目当前页按钮位于链接入口上方；默认名预填、改名、选组、全部分P、自定义批量序号；保存复用已读取元数据；链接读取与默认名、番剧拒绝、重复添加不覆盖名称/组、空名恢复默认。独立扩展测试页模拟tabs.query返回B站活动标签，其余实际运行扩展与storage。docs/addition-check-v1.3.json。
- **真实公共API与封面**：3个投稿成功获取，当前目标及3条清单封面均解码为160px HTTPS缩略图，请求无Referer；列表标题14px；预设、HEX、原生选色、重开持久化、Rare UI深浅色；1GiB+1提醒只进入手动清理且不删记录，尺寸不溢出。docs/customization-check-v1.3.json。
- **内容脚本联动**：实际HTMLMediaElement事件与扩展消息/存储；新增当前播放位置书签、不改续播位置；向后拖动，SPA切P边界与P1/P2隔离；未关注页面不写进度。docs/content-check-v1.3.json。
- **性能**：与保留v1.2包交替测量3/1000/5000条，各15次；100组5层的搜索/选择/滚动；0首屏组件请求、1次初始state读取。详见docs/PERFORMANCE.md及原始JSON。
- 构建、资源、语法、权限范围、两个官方源码SHA与实际import/bundle连接检查。用户确认的紫色图标已生成16/32/48/128px导出并被manifest/header引用。
- **安装包独立加载**：解压实际安装ZIP到单独目录，在新浏览器配置中只加载该目录；创建分组、官方ToastCard、官方ThemeSelector、深色切换、图标及400×520布局均通过，页面异常0。不依赖源码目录、node_modules或构建工具。docs/package-smoke-v1.3.json。

## 清理与数据约束

只有手动清理；旧autoCleanup=true强制禁用。删除及手动清理8秒可撤销，过期撤销缓存由维护任务回收。超过1,073,741,824字节才提醒并显示工具栏「!」，提醒不删数据。

1GB浏览器测试只模拟getBytesInUse返回值，没有分配1GB数据；Chrome默认约10MB配额未变，不申请unlimitedStorage。每组数据仍存单键focusState，schemaVersion=1兼容新增字段；旧记录读入默认组，首次写入持久化迁移，不改变原进度/书签。

## 验证边界

封面来自真实公共接口/CDN；播放采集使用同源受控WAV媒体，不能替代B站生产播放器、自动连播及记忆播放的完整人工验收。未做完整内存/长期运行或低性能设备测试。当前性能数据为温热缓存的本机无头浏览器测量，不承诺所有设备零额外耗时。首次元数据读取仍依赖B站接口响应；失败会保留待补全链接。

源码哈希：docs/source-hashes-v1.3.json。旧版JSON及历史报告作为历史证据保留。
`);
console.log('Wrote current verification and performance reports.');
