# TESLA RUN · 喷气翻滚跑酷

驾驶带喷气套件的新一代 Roadster，在霓虹夜城的高速上狂奔，一路逃费。
**按下空格** —— 喷口齐喷冷气，车身来一个标志性的空中后空翻，直接飞越收费站。

## 玩法

| 按键 | 作用 |
| --- | --- |
| `←` `→` / `A` `D` | 变道（触屏：左右滑动） |
| `空格` / `↑` / `W` | 喷气：车身后空翻，四个车尾喷口、车底和两侧喷口同时喷出冷气。**空中再按一次**：侧向桶滚，飞得更高 |
| `C` | 切换车漆（珍珠白 / 烈焰红 / 星际银 / 深海蓝 / 隐形黑） |
| `P` / `Esc` | 暂停 |
| `M` | 静音 |

- **能量条**：一次喷气消耗 50%，落地后约 1 秒回满；拾取电芯额外 +20%。
- **障碍：中国高速收费站主题**
  - 起落杆（道闸）：红白杆子横在路上，飞过去算「逃费成功」，也可以变道躲开。
  - 收费亭：就建在路中间，窗里的大爷在打瞌睡。
  - ETC 雨棚：只有绿灯那条通道可以直接过，其余通道落杆或有人。
  - 全封闭收费站：三条通道的杆全落下，只能飞过去。
  - 赛博皮卡：在收费站排队的老哥。
  - 限高架：**不要跳！** 限高 1.8m，会飞的也不行，贴地从下面穿过。
  - 排队 LED 牌：整面墙，需要二段喷气才能翻过去。
- **得分**：距离 + 电芯 + 飞越奖励。飞越时若车身正在翻转，奖励 ×1.5，连击最多 ×8。
- 撞毁时会有对应的吐槽：被道闸拦下、撞进收费亭、限高架不讲武德……

## 运行

在线游玩：<https://tesla.zelix.asia>（推送到 `main` 后由 GitHub Actions 自动打包并发布到 GitHub Pages）

本地：`npm run build` 后直接用浏览器打开 `dist/index.html`（单文件，无需服务器）。

开发：

```bash
npm install
npm start        # http://localhost:5173 ，刷新页面即自动重新打包
npm run build    # 生成 dist/index.html
```

技术栈：Three.js + esbuild；场景与障碍为程序化建模，音效与音乐全部由 WebAudio 实时合成。

## 车模

主角车模来自 Sketchfab：[“Tesla Roadster 2.0 (Will be enchanced soon)”](https://sketchfab.com/3d-models/8d5da3904e434fc3830edf558cb9014d) by Michael (@gmmichaelonearth)，许可 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。
游戏内使用的是减面压缩后的版本（约 97 万面、34.5 MB → 1.2 MB），开始界面左下角有署名。

- `assets/source/roadster_original.glb`：原始下载文件
- `assets/roadster.glb`：游戏使用的压缩版，构建时内嵌进 `dist/index.html`
- `assets/roadster.json`：车头朝向修正（`yaw`）与署名文字（`credit`）

换车模：用自己的 .glb 替换 `assets/roadster.glb`（建议先压缩），车头朝反就把 `yaw` 改成 0 或 180，再运行 `npm run build`。删掉 `assets/roadster.glb` 会回退到内置的程序化车身。

压缩命令：

```bash
npx gltf-transform optimize assets/source/roadster_original.glb assets/roadster.glb --compress meshopt --texture-compress webp --texture-size 1024 --simplify true --simplify-ratio 0.15 --simplify-error 0.0005
```
