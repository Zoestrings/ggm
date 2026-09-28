import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/**
 * Compresses an image to a maximum width of 800px and JPEG quality 0.6.
 * @param {string} uri Local URI of the image
 * @returns {Promise<string>} URI of the resized and compressed image
 */
export async function compressImage(uri) {
  const result = await manipulateAsync(
    uri,
    [{ resize: { width: 800 } }],
    { compress: 0.6, format: SaveFormat.JPEG }
  );
  return result.uri;
}
