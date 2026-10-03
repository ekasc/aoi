import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { emptyScanProgress, type AlbumEnrollment, type AutomaticAlbumStorage, type ScanDecisions, type ScanCheckpoint } from '@/features/album/automatic-album';
import { normalizeFaceEmbedding, SFACE_MODEL_ID } from '@/features/album/face-recognition-engine';

export function parseScanDecisions(raw: string | null): ScanDecisions {
  if (!raw) return Object.create(null);
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid scan index');
  const decisions: ScanDecisions = Object.create(null);
  for (const [id, item] of Object.entries(value)) {
    if (!item || typeof item !== 'object' || !('version' in item) || typeof item.version !== 'string'
      || !('photoIds' in item) || !Array.isArray(item.photoIds) || !item.photoIds.every((photoId: unknown) => typeof photoId === 'string')) throw new Error('Invalid scan index');
    decisions[id] = { version: item.version, photoIds: item.photoIds };
  }
  return decisions;
}

export function encodeFaceReference(embedding: Float32Array): string {
  const normalized = normalizeFaceEmbedding(embedding);
  const bytes = new Uint8Array(128 * 4);
  const view = new DataView(bytes.buffer);
  normalized.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

export function decodeFaceReference(raw: string): Float32Array {
  const binary = atob(raw);
  if (binary.length !== 128 * 4) throw new Error('Invalid face reference');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return normalizeFaceEmbedding(Float32Array.from({ length: 128 }, (_, index) => view.getFloat32(index * 4, true)));
}

export function parseScanCheckpoint(raw: string | null): ScanCheckpoint | null {
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('version' in value) || typeof value.version !== 'string'
    || !('after' in value) || (value.after !== null && typeof value.after !== 'string')
    || !('finished' in value) || typeof value.finished !== 'boolean' || !('progress' in value)
    || !value.progress || typeof value.progress !== 'object') throw new Error('Invalid scan checkpoint');
  const progress = emptyScanProgress();
  for (const key of Object.keys(progress)) {
    const number: unknown = Reflect.get(value.progress, key);
    if (key === 'total') {
      if (number === null || (typeof number === 'number' && Number.isSafeInteger(number) && number >= 0)) progress.total = number;
      else throw new Error('Invalid scan checkpoint');
    } else {
      if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) throw new Error('Invalid scan checkpoint');
      Reflect.set(progress, key, number);
    }
  }
  return { version: value.version, after: value.after, finished: value.finished, progress };
}

export function getAutomaticAlbumStorage(scopeKey: string): AutomaticAlbumStorage {
  const key = `aoi.auto-album.v1.${scopeKey}`;
  const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  return {
    async loadEnrollment() {
      if (Platform.OS === 'web') return null;
      const marker = await SecureStore.getItemAsync(`${key}.enabled`);
      if (!marker) return null;
      let referenceId: string | undefined;
      if (marker !== SFACE_MODEL_ID) {
        const value: unknown = JSON.parse(marker);
        if (!value || typeof value !== 'object' || !('modelId' in value) || value.modelId !== SFACE_MODEL_ID
          || !('referenceId' in value) || typeof value.referenceId !== 'string' || !value.referenceId) return null;
        referenceId = value.referenceId;
      }
      const prefix = referenceId ? `${key}.refs.${referenceId}` : key;
      const you = await SecureStore.getItemAsync(`${prefix}.you`);
      const partner = await SecureStore.getItemAsync(`${prefix}.partner`);
      if (!you || !partner) throw new Error('Face setup is incomplete');
      return { modelId: SFACE_MODEL_ID, ...(referenceId ? { referenceId } : {}), prints: [{ person: 'you', embedding: decodeFaceReference(you) }, { person: 'partner', embedding: decodeFaceReference(partner) }] };
    },
    async saveEnrollment(enrollment: AlbumEnrollment) {
      const prefix = enrollment.referenceId ? `${key}.refs.${enrollment.referenceId}` : key;
      if (enrollment.referenceId) {
        const raw = await AsyncStorage.getItem(`${key}.reference-ids`);
        const ids: unknown = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(ids) || !ids.every((id: unknown) => typeof id === 'string')) throw new Error('Invalid face reference index');
        await AsyncStorage.setItem(`${key}.reference-ids`, JSON.stringify([...new Set([...ids, enrollment.referenceId])]));
      }
      try {
        for (const print of enrollment.prints) {
          await SecureStore.setItemAsync(`${prefix}.${print.person}`, encodeFaceReference(print.embedding), options);
        }
        await SecureStore.setItemAsync(`${key}.enabled`, enrollment.referenceId ? JSON.stringify({ modelId: enrollment.modelId, referenceId: enrollment.referenceId }) : enrollment.modelId, options);
      } catch (error) {
        if (enrollment.referenceId) {
          await SecureStore.deleteItemAsync(`${prefix}.you`);
          await SecureStore.deleteItemAsync(`${prefix}.partner`);
        }
        throw error;
      }
    },
    async forgetEnrollment() {
      await SecureStore.deleteItemAsync(`${key}.enabled`);
      await SecureStore.deleteItemAsync(`${key}.you`);
      await SecureStore.deleteItemAsync(`${key}.partner`);
      const raw = await AsyncStorage.getItem(`${key}.reference-ids`);
      const ids: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(ids) || !ids.every((id: unknown) => typeof id === 'string')) throw new Error('Invalid face reference index');
      for (const id of ids) {
        await SecureStore.deleteItemAsync(`${key}.refs.${id}.you`);
        await SecureStore.deleteItemAsync(`${key}.refs.${id}.partner`);
      }
      await AsyncStorage.removeItem(`${key}.reference-ids`);
    },
    loadDecisions: async () => parseScanDecisions(await AsyncStorage.getItem(`${key}.decisions`)),
    saveDecisions: (decisions) => AsyncStorage.setItem(`${key}.decisions`, JSON.stringify(decisions)),
    loadCheckpoint: async () => parseScanCheckpoint(await AsyncStorage.getItem(`${key}.checkpoint`)),
    saveCheckpoint: (checkpoint) => AsyncStorage.setItem(`${key}.checkpoint`, JSON.stringify(checkpoint)),
  };
}
