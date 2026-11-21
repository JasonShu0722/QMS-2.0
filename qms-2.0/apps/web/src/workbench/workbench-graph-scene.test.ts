import { describe, expect, it } from 'vitest';
import { domainCenters, focusFrame, parallelCurvatures } from './workbench-graph-scene-layout';

describe('workbench star map layout', () => {
  it('frames both ends of distant cross-domain links with more room on narrow canvases', () => {
    const points = [{ x: -96, y: 12, z: 18 }, { x: 82, y: 20, z: -62 }, { x: 1, y: -24, z: 5 }];
    const narrow = focusFrame(points, .7);
    const wide = focusFrame(points, 1.6);
    expect(narrow.center).toEqual({ x: -7, y: -2, z: -22 });
    expect(narrow.distance).toBeGreaterThan(wide.distance);
    expect(narrow.distance * Math.sin(Math.atan(Math.tan(25 * Math.PI / 180) * .7))).toBeGreaterThan(Math.hypot(89, 22, 40));
  });
  it('uses repeatable, non-coplanar centers that respond to cross-domain edges', () => {
    const domains = ['API 接入', '主数据', '制程质量', '审核管理', '供应商质量'];
    const centers = domainCenters(domains, []);
    expect(domainCenters([...domains].reverse(), [])).toEqual(centers);
    const [origin, ...directions] = [...centers.values()];
    const [first, second, third] = directions.map(point => [point.x - origin.x, point.y - origin.y, point.z - origin.z]);
    const volume = first[0] * (second[1] * third[2] - second[2] * third[1])
      - first[1] * (second[0] * third[2] - second[2] * third[0]) + first[2] * (second[0] * third[1] - second[1] * third[0]);
    expect(Math.abs(volume)).toBeGreaterThan(100);
    const linked = domainCenters(domains, [{ from: domains[0], to: domains[1] }]);
    const distance = (map: typeof centers) => {
      const start = map.get(domains[0])!;
      const end = map.get(domains[1])!;
      return Math.hypot(start.x - end.x, start.y - end.y, start.z - end.z);
    };
    expect(distance(linked)).toBeLessThan(distance(centers));
  });

  it('keeps a single edge straight and separates reciprocal or parallel edges', () => {
    const curves = parallelCurvatures([
      { id: 'ab', from: 'a', to: 'b' }, { id: 'ba', from: 'b', to: 'a' }, { id: 'ac', from: 'a', to: 'c' },
    ]);
    expect(curves.get('ac')).toBe(0);
    expect(curves.get('ab')).not.toBe(0);
    expect(curves.get('ab')).toBe(curves.get('ba'));
  });
});
