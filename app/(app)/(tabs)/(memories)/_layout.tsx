import { Stack } from 'expo-router/stack';

// The Memories screen renders its own pinned, collapsing header (bar + view
// switch + search that stay put while the big title scrolls under them), so
// the native header is hidden here to avoid two headers fighting.
export default function MemoriesStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
