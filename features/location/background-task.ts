import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

/**
 * The ONLY background work location sharing ever does, and only in Live
 * mode: the OS wakes this task with new fixes and we hand the latest one to
 * the registered reporter. Everything else (on-request grants, Until I
 * arrive) stays foreground-only.
 *
 * Calm battery settings live where the task is STARTED (see
 * location-context): a distance interval of ~75 m and at most one report a
 * minute — never continuous high accuracy.
 */

export const LOCATION_BACKGROUND_TASK = 'aoi.location.background-report';

type BackgroundLocationBody = {
  locations: Location.LocationObject[];
};

type LocationReportCallback = (location: Location.LocationObject) => void;

let reportCallback: LocationReportCallback | null = null;

/** The context registers the active reporter; null stops all reporting. */
export function setLocationReportCallback(
  callback: LocationReportCallback | null
): void {
  reportCallback = callback;
}

// Defined at module scope so it exists before any background event can
// fire (Expo requirement). Errors are skipped silently — a missed fix is
// simply never reported, never surfaced.
TaskManager.defineTask<BackgroundLocationBody>(
  LOCATION_BACKGROUND_TASK,
  async ({ data, error }) => {
    if (error || !data) {
      return;
    }

    // Cold-start gap: after an OS restart the task can wake before the app
    // ever registers a reporter. Rather than silently drain the battery
    // while nothing is reported, stop the updates. (Rehydrating a live
    // session on launch is a future seam.)
    if (!reportCallback) {
      try {
        await Location.stopLocationUpdatesAsync(LOCATION_BACKGROUND_TASK);
      } catch {
        // Already stopped — still stopped.
      }
      return;
    }

    const latest = data.locations[data.locations.length - 1];

    if (latest) {
      reportCallback(latest);
    }
  }
);
