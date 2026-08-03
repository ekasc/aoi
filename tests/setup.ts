import { vi } from 'vitest';

function flattenStyle(style: any): any {
  if (Array.isArray(style)) {
    const merged: Record<string, any> = {};
    for (const s of style) {
      if (s && typeof s === 'object') Object.assign(merged, s);
    }
    return merged;
  }
  return style;
}

function createDiv(children: any, style: any, props: Record<string, any>) {
  const React = require('react');
  return React.createElement('div', { style: flattenStyle(style), ...props }, children);
}

function createSpan(children: any, style: any, props: Record<string, any>) {
  const React = require('react');
  return React.createElement('span', { style: flattenStyle(style), ...props }, children);
}

vi.mock('react-native', () => {
  const React = require('react');

  const View = (props: any) => {
    const { children, style, ...rest } = props;
    return createDiv(children, style, rest);
  };

  const Text = (props: any) => {
    const { children, style, ...rest } = props;
    return createSpan(children, style, rest);
  };

  const Image = ({ source, style, ...props }: any) => {
    const React = require('react');
    return React.createElement('img', { style: flattenStyle(style), src: source?.uri, ...props });
  };

  return {
    StyleSheet: {
      create: (styles: Record<string, any>) => styles,
      hairlineWidth: 1,
      absoluteFill: {},
      absoluteFillObject: {},
      flatten: flattenStyle,
    },
    View,
    Text,
    Image,
    Platform: { OS: 'ios', select: (obj: any) => obj.ios },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    PixelRatio: { get: () => 3 },
    StatusBar: { currentHeight: 44 },
    TouchableOpacity: View,
    TouchableHighlight: View,
    ScrollView: View,
    FlatList: View,
    ActivityIndicator: View,
    Modal: View,
    Pressable: View,
    KeyboardAvoidingView: View,
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
  };
});

vi.mock('expo', () => ({}));

vi.mock('@expo/vector-icons', () => {
  const React = require('react');
  const Icon = ({ name, size, color }: any) =>
    React.createElement('span', { 'data-icon': name, style: { color, fontSize: size } });

  return {
    Ionicons: Icon,
    FontAwesome: Icon,
    MaterialIcons: Icon,
  };
});

vi.mock('expo-audio', () => ({
  useAudioPlayer: () => ({
    play: () => {},
    pause: () => {},
    playing: false,
    currentTime: 0,
    duration: 0,
  }),
  useAudioRecorder: () => ({
    prepareToRecordAsync: async () => {},
    record: () => {},
    stop: async () => {},
    isRecording: false,
    uri: null,
  }),
  useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }),
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: async () => ({ granted: true }),
  setAudioModeAsync: async () => {},
}));

vi.mock('expo-notifications', () => ({
  requestPermissionsAsync: async () => ({ granted: false }),
  scheduleNotificationAsync: async () => '',
  setNotificationHandler: () => {},
}));

vi.mock('expo-haptics', () => ({
  impactAsync: async () => {},
  notificationAsync: async () => {},
  ImpactFeedbackStyle: { Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));

vi.mock('expo-asset', () => ({
  Asset: { fromModule: () => ({ uri: 'mock-uri' }) },
  useAssets: () => [null, false],
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: {}, manifest: {} },
  expo: { extra: {} },
}));

vi.mock('expo-file-system', () => ({
  documentDirectory: '/mock-documents/',
  cacheDirectory: '/mock-cache/',
  readAsStringAsync: () => Promise.resolve(''),
  writeAsStringAsync: () => Promise.resolve(),
  deleteAsync: () => Promise.resolve(),
  getInfoAsync: () => Promise.resolve({ exists: false, size: 0 }),
}));

class MockSQLiteDb {
  tables: Record<string, any[]> = {};

  _clearAll() {
    this.tables = {};
  }

  async execAsync(sql: string) {
    const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
    if (createMatch) {
      this.tables[createMatch[1]] = this.tables[createMatch[1]] ?? [];
    }
  }

  async getAllAsync<T>(sql: string, ..._params: any[]): Promise<T[]> {
    const fromMatch = sql.match(/FROM (\w+)/i);
    if (fromMatch) {
      const table = this.tables[fromMatch[1]];
      if (sql.includes('PRAGMA table_info')) {
        return [{ name: 'id' }, { name: 'title' }, { name: 'starts_at' }, { name: 'ends_at' },
          { name: 'actor' }, { name: 'actor_name' }, { name: 'label_preset' },
          { name: 'label_custom_text' }, { name: 'reminder_minutes' },
          { name: 'created_at' }, { name: 'updated_at' }] as any[];
      }
      return (table ?? []) as any;
    }
    return [];
  }

  async getFirstAsync<T>(sql: string, ..._params: any[]): Promise<T | null> {
    const fromMatch = sql.match(/FROM (\w+)/i);
    if (fromMatch) {
      const table = this.tables[fromMatch[1]];
      if (sql.includes('COUNT(')) {
        return { count: table?.length ?? 0 } as any;
      }
      return (table?.[0] ?? null) as any;
    }
    return null;
  }

  async runAsync(sql: string, ...params: any[]) {
    const trimmed = sql.trimStart();
    if (trimmed.startsWith('INSERT')) {
      const intoMatch = sql.match(/INTO (\w+)/i);
      if (intoMatch) {
        const table = intoMatch[1];
        this.tables[table] = this.tables[table] ?? [];
        const row: Record<string, any> = {};
        if (params) {
          const columns = sql.match(/\(([^)]+)\)/);
          if (columns) {
            const names = columns[1].split(',').map((c: string) => c.trim());
            names.forEach((name: string, i: number) => {
              row[name] = params[i];
            });
          }
        }
        this.tables[table].push(row);
      }
    } else if (trimmed.startsWith('DELETE')) {
      const fromMatch = sql.match(/FROM (\w+)/i);
      if (fromMatch && params && params[0] !== undefined) {
        const tableName = fromMatch[1];
        const table = this.tables[tableName];
        if (table) {
          this.tables[tableName] = table.filter((row: any) => row.id !== params[0]);
        }
      }
    } else if (trimmed.startsWith('UPDATE')) {
      const tableMatch = sql.match(/UPDATE (\w+)/i);
      if (tableMatch && params && params.length > 0) {
        const tableName = tableMatch[1];
        const table = this.tables[tableName];
        if (table) {
          const id = params[params.length - 1];
          const idx = table.findIndex((row: any) => row.id === id);
          if (idx >= 0) {
            const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/is);
            if (setMatch) {
              const setClauses = setMatch[1].split(',').map((s: string) => s.trim());
              const columns = setClauses.map((c: string) => c.replace(/\s*=\s*\?/i, '').trim());
              const setParams = params.slice(0, params.length - 1);
              columns.forEach((col: string, i: number) => {
                if (i < setParams.length) {
                  table[idx][col] = setParams[i];
                }
              });
            }
          }
        }
      }
    }
    return { lastInsertRowId: this.getTotalRows(), changes: 1 };
  }

  private getTotalRows() {
    return Object.values(this.tables).reduce((sum, t) => sum + t.length, 0);
  }

  close() {}
}

const mockDbSingleton = new MockSQLiteDb();
(globalThis as any).__mockDb = mockDbSingleton;

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => mockDbSingleton,
  openDatabaseSync: () => mockDbSingleton,
  useSQLiteContext: () => mockDbSingleton,
}));

vi.mock('expo-image', () => ({
  Image: ({ source, style, ...props }: any) => {
    const React = require('react');
    const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;
    return React.createElement('img', { style: flatStyle, src: source?.uri, alt: '', ...props });
  },
}));

vi.stubGlobal('__DEV__', false);
