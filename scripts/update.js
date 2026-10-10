#!/usr/bin/env node
/**
 * update.js - 更新文档内容
 * 
 * 功能说明：
 * - 更新 Siyuan Notes 中的文档内容（支持文档ID或笔记本路径）
 * - 提供文档ID验证，确保只更新文档而非子块
 * - 支持多种内容输入方式（命令行、文件、stdin）
 * - 自动处理内容中的转义字符
 * 
 * 限制说明：
 * - 只接受文档ID（type='d'），不接受块ID
 * - 不接受块ID，块更新请使用 block-update 命令
 */
const SiyuanConnector = require('./lib/connector');
const { checkPermission } = require('./lib/permission');
const { parseArgs } = require('./lib/args-parser');

const fs = require('fs');

const HELP_TEXT = `用法: update <docId> [content] [选项]
     update --path <path> [content] [选项]

更新 Siyuan Notes 中的文档内容（仅接受文档ID，或通过 --path 定位文档）

位置参数:
  docId                   文档ID
  content                 新内容（可选）

选项:
  -c, --content <text>    新内容
  -f, --file <path>       从文件读取内容
  -P, --path <path>       文档路径（如 /jeff/目录/文档；与 docId 二选一）
  --data-type <type>      数据类型：markdown（默认）/dom
  -h, --help              显示帮助信息

示例:
  update <id> "新内容"
  update <id> --file ./content.md
  update --path "/jeff/目录/文档" --content "新内容"
  update <id> -c "内容" --data-type markdown

限制:
  - 仅接受文档ID，不接受块ID
  - 路径必须唯一匹配到一个文档；路径可包含笔记本名称或ID
  - 如果传入块ID，将返回错误提示使用 block-update 命令

⚠️ 格式规范：更新内容时请遵循内部链接格式 ((id "文本"))
   详见: references/format-standard.md`;

/**
 * 辅助函数：处理内容中的换行符
 * @param {string} content - 原始内容
 * @returns {string} 处理后的内容
 */
function processContent(content) {
  return content ? content.replace(/\\n/g, '\n') : '';
}

/**
 * 验证ID是否为文档ID
 * @param {SiyuanConnector} connector - 连接器实例
 * @param {string} id - 要验证的ID
 * @returns {Promise<Object>} 验证结果 { isDoc: boolean, error?: string, docInfo?: Object }
 */
async function validateDocId(connector, id) {
  try {
    if (!/^\d{14}-[a-z0-9]{7}$/.test(id)) {
      return { isDoc: false, error: '无效的思源块ID格式' };
    }

    const pathInfo = await connector.request('/api/filetree/getPathByID', { id });
    if (!pathInfo || !pathInfo.notebook || !pathInfo.path) {
      return { isDoc: false, error: '无法获取文档信息，请检查ID是否正确' };
    }

    const storagePath = String(pathInfo.path).replace(/\\/g, '/');
    if (!storagePath.endsWith(`/${id}.sy`)) {
      return { 
        isDoc: false, 
        error: `传入的ID是子块，不是文档。请使用 block-update 命令更新块内容`,
        docInfo: { box: pathInfo.notebook, path: pathInfo.path }
      };
    }

    return {
      isDoc: true,
      docInfo: { box: pathInfo.notebook, path: pathInfo.path, type: 'd' }
    };
  } catch (error) {
    return { isDoc: false, error: `验证文档ID失败: ${error.message}` };
  }
}

/**
 * Resolve a human-readable document path to one document ID.
 * The first path component may be a notebook name or ID. Otherwise the
 * configured default notebook is used and the full path is notebook-relative.
 */
async function resolveDocumentPath(connector, path, defaultNotebook) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Error('文档路径不能为空');
  }

  const notebookResult = await connector.request('/api/notebook/lsNotebooks');
  const notebooks = notebookResult && Array.isArray(notebookResult.notebooks)
    ? notebookResult.notebooks
    : [];
  const matchedNotebook = notebooks.find(notebook =>
    notebook.name === parts[0] || notebook.id === parts[0]
  );

  let notebookId;
  let relativeParts;
  if (matchedNotebook) {
    notebookId = matchedNotebook.id;
    relativeParts = parts.slice(1);
  } else {
    notebookId = defaultNotebook;
    relativeParts = parts;
  }

  if (!notebookId) {
    throw new Error(`路径首段 "${parts[0]}" 不是笔记本名称或ID，且未配置默认笔记本`);
  }
  if (relativeParts.length === 0) {
    throw new Error('路径指向笔记本根目录，不是文档');
  }

  const ids = await connector.request('/api/filetree/getIDsByHPath', {
    notebook: notebookId,
    path: '/' + relativeParts.join('/')
  });
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('找不到指定路径的文档');
  }
  if (ids.length > 1) {
    throw new Error(`路径匹配到 ${ids.length} 个文档，请提供笔记本名称并确保路径唯一`);
  }

  return { id: ids[0], notebookId };
}

/**
 * 从文档信息中提取笔记本ID
 * @param {Object} docInfo - 文档信息对象
 * @returns {string|null} 笔记本ID，如果无法提取则返回null
 */
function extractNotebookId(docInfo) {
  if (!docInfo) return null;
  if (docInfo.box) return docInfo.box;
  if (docInfo.boxId) return docInfo.boxId;
  if (docInfo.notebookId) return docInfo.notebookId;
  if (docInfo.rootBoxId) return docInfo.rootBoxId;
  return null;
}

/**
 * 从 stdin 读取内容
 * @returns {Promise<string>} 读取的内容
 */
function readFromStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/**
 * 主入口函数
 */
async function main() {
  const args = process.argv.slice(2);
  const { options, positionalArgs } = parseArgs(args, {
    hasValueOpts: ['content', 'file', 'data-type', 'path'],
    shortOpts: { c: 'content', f: 'file', P: 'path' }
  });

  if (options.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  if (positionalArgs.length > 0) {
    options.docId = positionalArgs[0];
  }
  if (positionalArgs.length > 1 && options.content === undefined) {
    options.content = positionalArgs[1];
  }
  const params = options;

  if (params.docId && params.path) {
    console.error('错误: docId 和 --path 参数只能二选一');
    process.exit(1);
  }
  if (!params.docId && !params.path) {
    console.error('错误: 必须提供文档ID或 --path 参数');
    console.log(HELP_TEXT);
    process.exit(1);
  }

  try {
    const connector = SiyuanConnector.get();
    const config = connector.getConfig();

    if (params.path) {
      const resolved = await resolveDocumentPath(connector, params.path, config.defaultNotebook);
      params.docId = resolved.id;
    }

    let content = params.content;

    // 从文件读取内容
    if (params.file) {
      try {
        content = fs.readFileSync(params.file, 'utf8');
      } catch (fileError) {
        console.error('错误: 无法读取文件', params.file);
        console.error(fileError.message);
        process.exit(1);
      }
    }

    // 如果没有提供内容，尝试从 stdin 读取
    if (content === undefined && !process.stdin.isTTY) {
      content = await readFromStdin();
    }

    if (content === undefined) {
      console.error('错误: 缺少内容参数');
      console.log(HELP_TEXT);
      process.exit(1);
    }

    // 验证文档ID
    const validation = await validateDocId(connector, params.docId);
    
    if (!validation.isDoc) {
      console.error(JSON.stringify({
        success: false,
        error: '参数类型错误',
        message: validation.error
      }, null, 2));
      console.error('💡 提示：');
      console.error('   - 文档操作使用: update.js <docId>');
      console.error('   - 块操作使用: block-update.js <blockId>');
      console.error('📋 详见: references/quick-reference.md#id-类型区分');
      console.error('📋 问题排查: references/troubleshooting.md#id-类型错误');
      process.exit(1);
    }

    // 检查笔记本权限
    const notebookId = extractNotebookId(validation.docInfo);
    if (!notebookId) {
      console.error(JSON.stringify({
        success: false,
        error: '权限验证失败',
        message: '无法获取文档所在的笔记本信息'
      }, null, 2));
      process.exit(1);
    }
    
    // 执行权限检查
    try {
      checkPermission(config, notebookId);
    } catch (error) {
      console.error(JSON.stringify({
        success: false,
        error: '权限不足',
        message: error.message
      }, null, 2));
      process.exit(1);
    }

    // 处理内容中的换行符
    const processedContent = processContent(content);
    
    // 更新文档
    const dataType = params.dataType || 'markdown';
    const result = await connector.request('/api/block/updateBlock', {
      id: params.docId,
      dataType: dataType,
      data: processedContent
    });

    console.log(JSON.stringify({
      success: true,
      id: params.docId,
      operation: 'update-document',
      contentLength: content.length,
      notebookId: notebookId,
      timestamp: Date.now(),
      message: '文档内容已更新'
    }, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      error: error.message,
      message: '文档更新失败'
    }, null, 2));
    process.exit(1);
  }
}

main();
