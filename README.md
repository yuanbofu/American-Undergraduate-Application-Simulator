# American Undergraduate Application Simulator

一个模拟国际高中生申请海外大学、入读本科/硕博、再到求职发展的互动游戏。

## 主要内容
- 高中申请流程：`ED`、`RD`、候补、申诉、连读申请
- 大学发展流程：本科、硕士、博士分学期推进
- 就业流程：真实公司岗位、面试、Offer 拆信、最终去向选择
- AI 交流系统：可与中介、家人、同学、招生官、面试官等互动

## 运行方式

### 方式 1：直接打开
直接在浏览器打开 `/Users/yuanbo/Documents/college-sim/index.html`

### 方式 2：本地启动
推荐使用项目自带服务：

```bash
cd /Users/yuanbo/Documents/college-sim
npm start
```

然后访问：

```text
http://localhost:5173
```

## 测试

```bash
cd /Users/yuanbo/Documents/college-sim
npm test
```

## 项目结构
- `/Users/yuanbo/Documents/college-sim/index.html`：主界面
- `/Users/yuanbo/Documents/college-sim/styles.css`：样式
- `/Users/yuanbo/Documents/college-sim/app.js`：游戏主逻辑
- `/Users/yuanbo/Documents/college-sim/server.mjs`：本地服务与 AI 代理
- `/Users/yuanbo/Documents/college-sim/tests/app.integration.test.mjs`：集成测试
