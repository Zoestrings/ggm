import React from 'react';
import { View, StyleSheet } from 'react-native';

// A reusable component to create the premium FirstBank-style geometric background pattern.
export default function GeometricHeader() {
  return (
    <View style={styles.container} pointerEvents="none">
      {/* Top Left Shapes */}
      <View style={[styles.shape, styles.shapeLarge, { top: 20, left: -30, transform: [{ rotate: '15deg' }] }]} />
      <View style={[styles.shape, styles.shapeSmall, { top: 10, left: 80, transform: [{ rotate: '15deg' }] }]} />
      <View style={[styles.shape, styles.shapeMedium, { top: 60, left: 120, transform: [{ rotate: '15deg' }] }]} />

      {/* Top Right Shapes */}
      <View style={[styles.shape, styles.shapeMedium, { top: 15, right: 20, transform: [{ rotate: '-10deg' }] }]} />
      <View style={[styles.shape, styles.shapeSmall, { top: 5, right: 130, transform: [{ rotate: '-10deg' }] }]} />

      {/* Bottom Right Shapes */}
      <View style={[styles.shape, styles.shapeLarge, { bottom: -40, right: -20, transform: [{ rotate: '-20deg' }] }]} />
      <View style={[styles.shape, styles.shapeSmall, { bottom: 20, right: 100, transform: [{ rotate: '-20deg' }] }]} />

      {/* Bottom Left Shapes */}
      <View style={[styles.shape, styles.shapeMedium, { bottom: -10, left: 40, transform: [{ rotate: '25deg' }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    zIndex: 0, // Ensures it stays behind the text and cards
  },
  shape: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.04)', // The exact translucent look
  },
  shapeLarge: {
    width: 140,
    height: 140,
  },
  shapeMedium: {
    width: 100,
    height: 120,
  },
  shapeSmall: {
    width: 60,
    height: 80,
  },
});
