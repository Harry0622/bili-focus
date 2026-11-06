# 第三方组件与授权范围

项目自身代码采用根目录的MIT许可证。以下第三方代码保留各自授权，根目录MIT许可证不替代或取消这些条件。

## Rare UI

本项目实际使用 [Rare UI](https://rareui.com) 的ThemeSelector和ToastCard，来源为[官方仓库](https://github.com/swamimalode07/rare-ui)，固定提交与SHA-256记录在[vendor/rare-ui/provenance.json](vendor/rare-ui/provenance.json)。原始TSX没有修改；中文、主题色、懒加载与反馈位置由应用适配器提供。

Rare UI采用 **MIT + Commons Clause + Attribution**，与项目自身MIT授权范围不同。保留版权声明、署名及可见来源链接；具体条件以[vendor/rare-ui/LICENSE](vendor/rare-ui/LICENSE)原文为准。不能将其中组件本身作为独立组件包重新销售、分许可或分发。

Copyright (c) 2026 Swami Malode。

## 运行与构建依赖

React、React DOM、scheduler、Sonner、Motion/framer-motion、motion-dom、motion-utils、figma-squircle、clsx、tailwind-merge、Tailwind CSS、tslib的许可证随构建结果保存在[assets/licenses](assets/licenses)。依赖精确版本见package-lock.json；esbuild等构建依赖的原始许可随对应npm软件包提供。

生成的JavaScript还保留对应LEGAL.txt文件。修改、发布或再打包时，请同时保留相关版权和许可文件。

## 名称、图标与示例图片

这是独立项目，并非哔哩哔哩官方扩展。B站名称及界面元素用于说明适用平台，不代表官方关联或背书。截图中的视频封面来自公开投稿，用于展示界面；分组、观看进度与部分名称为演示数据，不属于用户个人清单。
