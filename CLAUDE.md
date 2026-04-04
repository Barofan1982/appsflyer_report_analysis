# CLAUDE.md — AppsFlyer Report Analysis

## 项目概述
基于 Gemini API 的 AppsFlyer 广告投放数据智能分析工具（Web 应用）。
上传 CSV 报告后自动完成列头中译、数值格式化、AI 深度分析。

## 技术栈
- React 19 + TypeScript / Vite 6 / Tailwind CSS 4
- Google Gemini API（`@google/genai`）
- PapaParse（CSV 解析）/ Framer Motion（动画）/ react-markdown（渲染报告）
- 原始来源：Google AI Studio 导出项目

## 文件结构
```
src/
  App.tsx           # 主组件（上传、翻译、分析、表格、导出）
  main.tsx          # 入口
  index.css         # 全局样式
  lib/utils.ts      # cn() 工具函数
index.html          # HTML 模板
vite.config.ts      # Vite 配置（注入 GEMINI_API_KEY）
tsconfig.json       # TypeScript 配置
package.json        # 依赖与脚本
.env.example        # 环境变量示例
```

## 功能要点
- CSV 拖拽/选择上传，PapaParse 解析
- Gemini Flash 自动翻译英文列头为中文（≤5 字）
- 按列头关键词自动识别格式（百分比 / 货币 / 数值 / 文本）
- Gemini Pro 生成投放分析报告（Markdown 格式）
- 表格搜索、排序、汇总行（合计/均值）
- 导出处理后 CSV（含翻译列头 + 格式化数值）
- 导出分析报告为 Markdown 文件

## 开发与运行
```bash
npm install
# 在 .env.local 中设置 GEMINI_API_KEY
npm run dev          # 本地开发 http://localhost:3000
npm run build        # 生产构建
npm run lint         # TypeScript 类型检查
```

## 规则
- API Key 通过 `.env.local` 注入，禁止硬编码或提交到仓库
- 修改 Gemini 模型名称时注意版本兼容性（当前使用 gemini-3-flash-preview / gemini-3.1-pro-preview）
