import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { organizationAdministrativeAffectedAssignments } from '../../src/modules/organization/organization-administrative-impact.read-model.js';

function sources(directory: string): ts.SourceFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'generated') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : path.endsWith('.ts')
      ? [ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)] : [];
  });
}

describe('complete API source / supplier administrative organization ownership', () => {
  const api = sources(resolve('src'));
  const source = api.find(file => file.fileName.endsWith('supplier-eight-d.service.ts'))!;
  const service = source.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node)
    && node.name?.text === 'SupplierEightDService')!;
  const methods = new Map(service.members.filter(ts.isMethodDeclaration).map(method => [method.name.getText(source), method]));

  it('routes every reachable administrative organization read through its owner, including recovery helpers', () => {
    const pending = [...methods.keys()].filter(name => name.startsWith('administrative'));
    const visited = new Set<string>(), violations: string[] = [];
    while (pending.length) {
      const name = pending.pop()!;
      if (visited.has(name)) continue;
      visited.add(name);
      const method = methods.get(name)!;
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword && methods.has(node.expression.name.text)) {
          pending.push(node.expression.name.text);
        }
        if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'tx'
          && /^(organization|department|position|userPosition)$/.test(node.name.text)) {
          violations.push(`${name}: ${node.getText(source)}`);
        }
        if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          if (/\b(?:FROM|JOIN)\s+(?:organizations|departments|positions|user_positions|department_management_bindings|department_minister_scopes)\b/i.test(node.getText(source))) {
            violations.push(`${name}: organization-owned SQL`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(method);
    }
    for (const root of ['administrativeDeadlinePredicate', 'administrativeRequiredConfiguration', 'administrativeReconfigure']) {
      expect(visited.has(root)).toBe(true);
    }
    expect(violations).toEqual([]);
  });

  it('keeps the published external source lock and exact post-lock SQE validation', () => {
    const freeze = methods.get('freezeClosureSqe')!.getText(source);
    expect(freeze).toContain('FOR SHARE OF u, a, p, d SKIP LOCKED');
    expect(freeze).toContain('this.sqeAssignment(tx, c.organizationId, c.sqeAssignmentId)');
    expect(freeze).toContain('assignment.userId !== c.sqeUserId');
    expect(freeze).toContain('assignment.position.departmentId !== c.responsibleSectionDepartmentId');
  });

  it('exposes only a tenant-bound parameterized relation, without reading supplier or identity tables', () => {
    const relation = organizationAdministrativeAffectedAssignments('org', ['department'], ['position']);
    expect(relation.values).toEqual(['org', ['department'], ['position']]);
    expect(relation.text).toContain('WHERE up.organization_id = $1::uuid');
    expect(relation.text).toContain("b.responsibility = 'SECTION_MANAGER' AND b.status = 'ACTIVE'");
    expect(relation.text).not.toMatch(/\bsupplier_|\b(?:FROM|JOIN)\s+users\b|\b(?:UPDATE|DELETE|INSERT)\b/i);
    expect(relation.text).not.toContain('FOR ');
  });
});
