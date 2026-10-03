import { Redirect } from 'expo-router';

/** Old recognition deep links never activate the experimental scanner. */
export default function CheckPhotoRoute() {
  return <Redirect href="/(app)/(tabs)/together" />;
}
