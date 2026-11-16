# Commentary Video Production Skill

## 中文 | [English](#english)

> [!NOTE]
> skill 默认需要 OBS、WSL 环境、ffmpeg、fast-whisper，且指定了 fish audio 的 API 调用方式。如果你也想使用此技能，请先准备好这些环境和工具，并修改 fish audio 的 API 调用方式。

访问我的 B 站主页。[Bilibili](https://space.bilibili.com/29140520)。用于制作杂谈、评论与解说类视频的 Codex 技能，覆盖口播音频与字幕、素材准备、分镜、网页画面、录制与合成、封面和成片检查。

技能根据已有产物和用户确认事项选择当前阶段，每一步定义输入、输出和切换条件。入口文件为 [SKILL.md](SKILL.md)。

### 制作流程

| 步骤 | 内容 | 文件 |
|---|---|---|
| 01 音频处理 | 检查与整理录音，或生成 TTS，输出连续无损 WAV 和 ASS 字幕 | [01-音频处理.md](01-音频处理.md) |
| 02 视频素材准备 | 准备基础素材，为有字幕的视频建立字幕索引 | [02-视频素材准备.md](02-视频素材准备.md) |
| 03 分镜 | 以最终口播时间轴编写分镜，列出缺失素材和动画运动描述，交由用户确认 | [03-分镜.md](03-分镜.md) |
| 04 视频制作 | 制作网页画面、剪辑与动画，确认录制方案后录制或渲染，完成音视频合成 | [04-视频制作.md](04-视频制作.md) |
| 05 封面制作 | 使用 HTML 制作封面，导出 16:9 和 4:3 两版 PNG | [05-封面制作.md](05-封面制作.md) |
| 06 成片检查 | 检查画面、切点、字幕、音频、封面与播放情况 | [06-成片检查.md](06-成片检查.md) |

### 制作方式

- 成片标准为 1920×1080、25fps、Rec.709 SDR。
- 视频画面使用网页制作，通常通过 OBS 录制。
- 口播支持用户录音和 Fish Audio TTS，使用 fast-whisper 辅助转写与打轴。
- 在 WSL 中调用命令行工具，使用 ffmpeg 完成合成，音频单独导出无损 WAV，再与视频合并。

## English

> [!NOTE]
> This skill requires OBS, WSL, ffmpeg, fast-whisper, and a specified method for calling the Fish Audio API. If you want to use this skill, please prepare these environments and tools, and modify the Fish Audio API call method accordingly.

Visit my Bilibili channel. [Bilibili](https://space.bilibili.com/29140520). This is a Codex skill for producing commentary and discussion videos. It covers narration and subtitles, source materials, storyboarding, browser-based visuals, recording and muxing, thumbnails, and final review.

The skill selects the current stage based on existing artifacts and user approvals. Each stage defines its inputs, outputs, and transition conditions. Start with [SKILL.md](SKILL.md).

### Workflow

| Stage | Scope | File |
|---|---|---|
| 01 Audio processing | Review and edit recordings, or generate TTS, then produce a continuous lossless WAV and ASS subtitles | [01-音频处理.md](01-音频处理.md) |
| 02 Source preparation | Prepare source materials and create subtitle indexes for subtitled videos | [02-视频素材准备.md](02-视频素材准备.md) |
| 03 Storyboarding | Build a storyboard around the final narration timeline, list missing assets and animation movements, and obtain user approval | [03-分镜.md](03-分镜.md) |
| 04 Video production | Create browser-based visuals, edits, and animations, obtain approval for the recording plan, then record or render and mux the video and audio | [04-视频制作.md](04-视频制作.md) |
| 05 Thumbnail creation | Build thumbnails in HTML and export 16:9 and 4:3 PNG versions | [05-封面制作.md](05-封面制作.md) |
| 06 Final review | Check visuals, cuts, subtitles, audio, thumbnails, and playback | [06-成片检查.md](06-成片检查.md) |

### Production approach

- Output at 1920×1080, 25fps, Rec.709 SDR.
- Build visuals with web technologies and usually record with OBS.
- Use supplied narration recordings or Fish Audio TTS, with fast-whisper assisting transcription and subtitle timing.
- Run command-line tools in WSL and use ffmpeg for assembly. Export audio separately as lossless WAV, then mux it with the video.
