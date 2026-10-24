/**
 * 平台定义（共享）：background / content / popup 三端共用。
 * 注意：本文件以经典脚本方式加载，挂载到 self 上。
 * 新增平台时：在此登记 + 在 content/adapters/index.js 实现适配器。
 *
 * mode:
 *  - 'fill'（默认）：打开编辑页后由 content 脚本自动填充；
 *  - 'copy'：内容自动复制到剪贴板，打开平台页面后用户手动 Ctrl+V 粘贴
 *    （适用于没有网页文章编辑器或编辑器结构不稳定的小红书/微博/X 等）。
 * copyFormat: 该平台填充失败时「⧉ 复制」按钮复制的格式——
 *  - 'md'：Markdown 类编辑器，复制「标题 + Markdown 源文本」；
 *  - 缺省：富文本类编辑器，复制（带主题样式的）HTML 正文。
 * experimental: 平台网格中显示"!"标记，提示适配器可能随平台改版失效。
 */
(function () {
  'use strict';
  self.MULTIPOST_PLATFORMS = [
    {
      id: 'zhihu',
      name: '知乎专栏',
      color: '#0066ff',
      editorUrl: 'https://zhuanlan.zhihu.com/write',
      hosts: ['zhuanlan.zhihu.com']
    },
    {
      id: 'juejin',
      name: '掘金',
      color: '#1e80ff',
      editorUrl: 'https://juejin.cn/editor/drafts/new',
      hosts: ['juejin.cn'],
      copyFormat: 'md'
    },
    {
      id: 'csdn',
      name: 'CSDN',
      color: '#fc5531',
      editorUrl: 'https://editor.csdn.net/md/',
      hosts: ['editor.csdn.net'],
      copyFormat: 'md'
    },
    {
      id: 'weixin',
      name: '微信公众号',
      color: '#07c160',
      editorUrl:
        'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77',
      hosts: ['mp.weixin.qq.com']
    },
    {
      id: 'toutiao',
      name: '今日头条',
      color: '#ff0033',
      editorUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish',
      hosts: ['mp.toutiao.com']
    },
    {
      id: 'jianshu',
      name: '简书',
      color: '#ea6f5a',
      editorUrl: 'https://www.jianshu.com/writer',
      hosts: ['www.jianshu.com'],
      copyFormat: 'md',
      experimental: true
    },
    {
      id: 'cnblogs',
      name: '博客园',
      color: '#3cafb6',
      editorUrl: 'https://i.cnblogs.com/posts/edit',
      hosts: ['i.cnblogs.com'],
      copyFormat: 'md',
      experimental: true
    },
    {
      id: 'bilibili',
      name: 'B站专栏',
      color: '#fb7299',
      // 旧版 read/editor/#/web 已下线（提示"旧版编辑器已停止使用"），改用新版 york 编辑器
      editorUrl: 'https://member.bilibili.com/york/read-editor',
      hosts: ['member.bilibili.com'],
      experimental: true
    },
    {
      id: 'baijiahao',
      name: '百家号',
      color: '#2932e1',
      editorUrl: 'https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1',
      hosts: ['baijiahao.baidu.com'],
      experimental: true
    },
    {
      id: 'cto51',
      name: '51CTO博客',
      color: '#f54336',
      editorUrl: 'https://blog.51cto.com/blogger/publish',
      hosts: ['blog.51cto.com'],
      copyFormat: 'md',
      experimental: true
    },
    {
      id: 'oschina',
      name: '开源中国',
      color: '#009a61',
      editorUrl: 'https://my.oschina.net/blog/write',
      hosts: ['my.oschina.net'],
      copyFormat: 'md',
      experimental: true
    },
    {
      id: 'tencentcloud',
      name: '腾讯云社区',
      color: '#0052d9',
      editorUrl: 'https://cloud.tencent.com/developer/article/write-new',
      hosts: ['cloud.tencent.com'],
      copyFormat: 'md',
      experimental: true
    },
    {
      id: 'aliyun',
      name: '阿里云社区',
      color: '#ff6a00',
      editorUrl: 'https://developer.aliyun.com/article/new',
      hosts: ['developer.aliyun.com'],
      copyFormat: 'md',
      experimental: true
    },
    /* ---- 复制模式：内容进剪贴板，打开页面后手动粘贴（微博/X/Facebook 等） ---- */
    /* ---- 小红书长文（实验性自动填充；失败自动降级为复制兜底） ---- */
    {
      id: 'xiaohongshu',
      name: '小红书长文',
      color: '#ff2442',
      editorUrl: 'https://creator.xiaohongshu.com/publish/publish?source=official',
      hosts: ['creator.xiaohongshu.com'],
      mode: 'fill',
      copyFormat: 'md',
      experimental: true
    },
    {
      id: 'weibo',
      name: '微博',
      color: '#e6162d',
      editorUrl: 'https://weibo.com/compose/post',
      hosts: ['weibo.com'],
      mode: 'copy',
      experimental: true
    },
    {
      id: 'x',
      name: 'X(推特)',
      color: '#111111',
      editorUrl: 'https://x.com/compose/post',
      hosts: ['x.com'],
      mode: 'copy',
      experimental: true
    },
    {
      id: 'facebook',
      name: 'Facebook',
      color: '#1877f2',
      editorUrl: 'https://www.facebook.com/',
      hosts: ['facebook.com'],
      mode: 'copy',
      experimental: true
    },
    /* ---- 抖音长文（实验性；长文页为 creator-micro/content/post/article） ---- */
    {
      id: 'douyin',
      name: '抖音长文',
      color: '#161823',
      editorUrl: 'https://creator.douyin.com/creator-micro/content/post/article',
      hosts: ['creator.douyin.com'],
      mode: 'fill',
      copyFormat: 'md',
      experimental: true
    },
    {
      id: 'nowcoder',
      name: '牛客网',
      color: '#0f9d58',
      editorUrl: 'https://www.nowcoder.com/creator',
      hosts: ['nowcoder.com'],
      mode: 'copy',
      experimental: true
    },
    {
      id: 'demo',
      name: '本地演示页',
      color: '#8b5cf6',
      editorUrl: 'http://localhost:8788/demo-editor.html',
      hosts: ['localhost', '127.0.0.1'],
      copyFormat: 'md'
    }
  ];
})();
