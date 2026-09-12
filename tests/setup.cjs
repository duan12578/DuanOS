jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => `test-${Math.random()}`) }));
jest.mock('../src/notifications', () => ({ schedule: jest.fn(async () => false), cancel: jest.fn(async () => {}) }));
