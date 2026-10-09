import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

/**
 * This device's stable name in the album.
 *
 * The device id is a random UUID kept in ordinary app storage. It is not a
 * secret and not a key: it is the label the backup uses to tell one phone from
 * another so an envelope can be addressed and a device key can be replaced
 * rather than duplicated. The private keys live in the keystore; this is only
 * what they are filed under.
 */
const DEVICE_ID_KEY = 'aoi.device.id.v1';

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }
  const deviceId = randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}
