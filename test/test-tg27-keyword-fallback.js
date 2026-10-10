/**
 * TG-27 Verify keyword mode falls back to SiYuan search without vector services.
 */
const { createTestContext } = require('./test-framework');

const ctx = createTestContext('TG-27 关键词搜索回退测试');
const uniqueTerm = `TG27Keyword${Date.now()}`;
const title = `TG-27 搜索回退测试_${Date.now()}`;
const created = ctx.runCmd(`create "${title}" "${uniqueTerm}" --parent-id ${ctx.PARENT_ID}`);
const docId = ctx.extractDocId(created.output);

async function main() {
  console.log('\n测试用例:');
  if (!created.success || !docId) {
    ctx.addResult('TG-27-001', '创建搜索样例', 'create <title> --parent-id <id>',
      '创建一篇用于验证的临时文档', '文档创建失败', false, created.error);
  } else {
    ctx.createdDocs.push({ id: docId, title, testId: 'TG-27-001' });
    // Document creation and SQL search indexing are not guaranteed to complete
    // in the same request; allow the index to catch up before checking results.
    await new Promise(resolve => setTimeout(resolve, 1500));
    const result = ctx.runCmd(`search "${uniqueTerm}" --mode keyword --limit 10`);
    let data = null;
    try {
      data = JSON.parse(result.output);
    } catch (_) {
      data = null;
    }
    const found = !!data?.success && Array.isArray(data.data?.blocks) &&
      data.data.blocks.some(block => block.content?.includes(uniqueTerm));
    ctx.addResult('TG-27-001', '无向量服务时关键词搜索可用',
      `search "${uniqueTerm}" --mode keyword --limit 10`,
      '返回包含临时文档的搜索结果', found ? '搜索成功' : '未找到临时文档', found,
      found ? '原生关键词搜索回退正常' : result.error || result.output);
  }

  ctx.cleanup();
  ctx.saveReports('TG-27-keyword-fallback', 'TG-27 关键词搜索回退测试报告');
}

main().catch(error => {
  console.error('测试执行失败:', error.message);
  ctx.cleanup();
  process.exitCode = 1;
});
