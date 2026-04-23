# USB PD Sniffer Web

一个基于 Web 的 USB Power Delivery (PD) 嗅探器界面。

## 项目介绍

本项目是一个用于 **USB Power Delivery (PD) 嗅探器** 的 Web 前端应用。它利用 **WebHID API** 通过浏览器直接与硬件设备进行通信。

核心功能包括：
*   实时捕获和显示 USB PD 协议的通信数据。
*   对捕获到的数据进行解析、分析和可视化。
*   可能还包含一些控制硬件设备的功能。

项目中使用了 `react-window`，这表明该应用针对高效处理和显示大量数据进行了优化，这符合嗅探器应用的场景。

## 技术栈

*   **前端框架：** [React](https://react.dev/) (v19)
*   **构建工具：** [Vite](https://vitejs.dev/)
*   **编程语言：** [TypeScript](https://www.typescriptlang.org/)
*   **CSS 方案：** [Tailwind CSS](https://tailwindcss.com/)
*   **代码检查：** [ESLint](https://eslint.org/)
*   **包管理器：** [pnpm](https://pnpm.io/)
*   **核心 API:** [WebHID (Web Human Interface Device) API](https://developer.mozilla.org/zh-CN/docs/Web/API/WebHID_API)，用于浏览器与硬件设备通信。



本项目是一个 pd 协议分析仪的网页上位机，硬件通过 usb hid 来上传数据，网页通过 web hid 读取。
网页使用 React + Tailwind CSS 技术栈，构建单页应用。
在 react 中实现读取 hid 数据，展示出来​。