const nodes = ['ACTION', 'APPROVAL', 'VERIFICATION', 'CC', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'];
export function WorkflowDesignerPage() { return <main><h1>流程设计器</h1><p>白名单节点：{nodes.join('、')}</p><button type="button">保存草稿</button><button type="button">发布</button></main>; }
