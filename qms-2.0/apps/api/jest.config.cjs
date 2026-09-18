module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test[\\\\/].*[.-]spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.spec.json', useESM: true },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^@qms/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
