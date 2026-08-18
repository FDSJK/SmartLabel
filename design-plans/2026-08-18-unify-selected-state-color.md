# 统一「选中态」背景为主色蓝

Written against: `228c5d9895b939b2e4af5e27f1e05d94a02dca49`

## Evidence chain

- Surface: 标注页 `AnnotationPage` 的三个选中态元素（左栏图像列表、右栏标签状态列表、右栏标注列表）。
- Problem: 同一「选中」元素上，背景是青色 `rgba(0,188,212,0.12)`，而边框/描边是蓝色 `#2563eb`，两种色相冲突。
- Design evidence: `src/index.css:2` 定义 `--color-primary: #2563eb`（唯一主色）；`src/index.css` **未定义** `--color-selected`。
- Owner: `--color-selected` 应由 `src/index.css` 的 `:root` 拥有（与其它 `--color-*` token 同处）。
- Scope and affected surfaces:
  - `src/components/panels/ImageList.module.css:5` `.itemActive`（左栏当前选中的图像）
  - `src/components/panels/RightPanel.module.css:135` `.shapeItemSelected`（右栏当前选中的 shape）
  - `src/components/panels/LabelStatusList.module.css:33` `.itemSelected`（右栏当前选中的标签）
- Uncertainty: none（三个文件的 fallback 值一致，均为 `rgba(0,188,212,0.12)`）。

## Design decision

在 `src/index.css` 的 `:root` 中新增一个 token：

```css
--color-selected: rgba(37, 99, 235, 0.12);
```

`rgba(37,99,235,0.12)` 是主色 `#2563eb` 的 12% 透明版，与现有三个组件里 fallback 的透明度（0.12）保持一致，只是把色相从旧青色 `#00bcd4` 换成现行主色蓝 `#2563eb`。新增后，三处 `var(--color-selected, ...)` 都会解析到该值，选中态即变为「蓝背景 + 蓝边框」，消除色相冲突。根因是 `--color-selected` 从未定义、组件回退到旧主题青色残留值；定义该 token 即从源头修复。

## Reuse

- `--color-primary`（`src/index.css:2`，`#2563eb`）是本决定的唯一依据，新 token 的值由其派生。
- Exemplar: 现有 fallback 透明度 `0.12` 取自 `ImageList.module.css:5` 等三处既有写法。

无需新建 primitive 体系：`--color-selected` 属于 `index.css` 既有的 `--color-*` token 族，直接补入即可。

## Changes

1. `src/index.css`
   - Change: 在 `:root` 块的色彩 token 区（建议紧随 `--color-primary-hover: #1d4ed8;` 之后）新增一行 `--color-selected: rgba(37, 99, 235, 0.12);`。
   - Preserve: 不改动任何既有 token；不改动组件 `.module.css` 中的 `var(--color-selected, rgba(0,188,212,0.12))` 引用（新增定义后其 fallback 自动失效，无需触碰）。
   - Verify: `grep -n "color-selected" src/index.css` 输出新行；三处组件无需改动。

## Scope

- Inherit: `ImageList`、`RightPanel`、`LabelStatusList` 三处选中态自动获得蓝色背景。
- Verify: 左栏选中图像、右栏选中标签、右栏选中 shape 的 hover/选中呈现（仅背景色相变化，布局与边框不变）。
- Exclude:
  - `var(--color-primary, #00bcd4)` 中的死 fallback（`#00bcd4`）在 `ImageList.module.css:5`、`RightPanel.module.css:58/90/135`、`LabelStatusList.module.css:33` 中仍有残留，但 `--color-primary` 已定义、该 fallback 永不生效，**不在本次修改范围**，可作为后续清理项。
  - 不涉及 `--color-hover`（白色 hover）、`--color-error`（红）两个问题（分别是独立 finding，另行决定）。

## Validation

- Product: 打开标注页，选中一张图 / 一个标签 / 一条 shape，确认其背景色从青色变为淡蓝，边框保持蓝色。
- Interface: 覆盖「标签状态」与「标注」两个 tab、选中/取消选中切换、深色画布下左栏与右栏两个主题。
- System: 确认未新增并行 color token，`--color-selected` 与 `--color-primary` 同源。
- Repository: `cd frontend && npm run build` → 构建成功（CSS 变量为静态值，不影响 tsc）。

## Stop conditions

- Stop if 三处组件里出现**不同于** `rgba(0,188,212,0.12)` 的其它选中态 fallback 值（说明 scope 需扩大）。
- Stop if `--color-selected` 在仓库其它位置已被定义（则本次应改为修改该定义，而非新增）。

## Design documentation

- After acceptance and validation: 在 `src/index.css` 的 `:root` 中新增的 `--color-selected` 注释（如 `/* 选中态背景：主色 12% 透明 */`）即为其文档记录；仓库无独立 DESIGN.md，无需额外落档。
