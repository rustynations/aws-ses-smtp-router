module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  // TypeScript first. Jest's default puts 'js' ahead of 'ts', so any leftover
  // compiled output beside a source file silently shadows it and the suite
  // tests a stale build instead of the code you just edited.
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'cjs', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  }
};
