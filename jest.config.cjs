module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/tests/*.ui.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.cjs'],
};
