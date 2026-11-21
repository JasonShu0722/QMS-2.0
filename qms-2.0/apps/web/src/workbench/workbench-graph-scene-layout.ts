export type Position = { x: number; y: number; z: number };
type Connection = { from: string; to: string };

const axes = ['x', 'y', 'z'] as const;

export function focusFrame(points: readonly Position[], aspect: number) {
  const center = Object.fromEntries(axes.map(axis => {
    const coordinates = points.map(point => point[axis]);
    return [axis, (Math.min(...coordinates) + Math.max(...coordinates)) / 2];
  })) as Position;
  const radius = Math.max(...points.map(point => Math.hypot(...axes.map(axis => point[axis] - center[axis]))));
  const halfAngle = Math.atan(Math.tan(25 * Math.PI / 180) * Math.min(1, aspect));
  return { center, distance: Math.max(93, (radius + 27) / Math.sin(halfAngle)) };
}

export function domainCenters(domains: readonly string[], connections: readonly Connection[]) {
  const names = [...new Set(domains)].sort();
  const centers = new Map<string, Position>(names.map((name, index) => {
    const height = 1 - (2 * index + 1) / names.length;
    const radius = Math.sqrt(1 - height * height) * (95 + (index % 4) * 23);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    return [name, { x: Math.cos(angle) * radius, y: height * (120 + index % 3 * 12), z: Math.sin(angle) * radius }] as const;
  }));
  const links = new Map<string, [Position, Position, number]>();
  for (const { from, to } of connections) {
    if (from === to) continue;
    const key = JSON.stringify([from, to].sort());
    const prior = links.get(key);
    if (prior) prior[2] += 1;
    else if (centers.has(from) && centers.has(to)) links.set(key, [centers.get(from)!, centers.get(to)!, 1]);
  }
  const points = [...centers.values()];
  for (let tick = 0; tick < 36; tick += 1) {
    for (const [start, end, weight] of links.values()) {
      const distance = Math.hypot(...axes.map(axis => end[axis] - start[axis]));
      const pull = distance > 65 ? (distance - 65) / distance * Math.min(0.02, weight * 0.006) : 0;
      for (const axis of axes) {
        const movement = (end[axis] - start[axis]) * pull;
        start[axis] += movement;
        end[axis] -= movement;
      }
    }
    for (const [index, start] of points.entries()) {
      for (let other = index + 1; other < points.length; other += 1) {
        const end = points[other];
        const distance = Math.hypot(...axes.map(axis => end[axis] - start[axis]));
        if (distance === 0 || distance >= 69) continue;
        const separation = (69 - distance) / distance * .085;
        for (const axis of axes) {
          const movement = (end[axis] - start[axis]) * separation;
          start[axis] -= movement;
          end[axis] += movement;
        }
      }
    }
  }
  return centers;
}

export function parallelCurvatures(edges: readonly (Connection & { id: string })[]) {
  const groups = new Map<string, (Connection & { id: string })[]>();
  for (const edge of edges) {
    const key = JSON.stringify([edge.from, edge.to].sort());
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  }
  return new Map([...groups.values()].flatMap(group => group.map((edge, index) => [
    edge.id, (index - (group.length - 1) / 2) * Math.min(.27, .8 / group.length) * (edge.from <= edge.to ? 1 : -1),
  ] as const)));
}
