/**
 * "Scan a QR code" glyph drawn from views (no icon dependency): four
 * viewfinder corner brackets framing a miniature QR code — three finder
 * squares plus data dots, like the classic scan-QR symbol.
 */
import { View } from 'react-native';
import { useColors } from '@/theme/theme';

export function ScanIcon({ size = 22, color }: { size?: number; color?: string }) {
  const colors = useColors();
  const c = color ?? colors.text;

  // Outer viewfinder brackets.
  const bw = Math.max(2, Math.round(size / 11));
  const corner = Math.round(size * 0.28);
  const r = Math.max(2, Math.round(size / 9));
  const bracket = {
    position: 'absolute' as const,
    width: corner,
    height: corner,
    borderColor: c,
  };

  // Inner miniature QR code.
  const inset = Math.round(size * 0.2);
  const inner = size - inset * 2;
  const box = Math.max(4, Math.round(inner * 0.42));
  const fbw = Math.max(1, Math.round(size / 16));
  const dot = Math.max(2, Math.round(inner * 0.2));
  const finder = {
    position: 'absolute' as const,
    width: box,
    height: box,
    borderWidth: fbw,
    borderColor: c,
  };

  return (
    <View style={{ width: size, height: size }}>
      {/* Brackets */}
      <View style={[bracket, { top: 0, left: 0, borderTopWidth: bw, borderLeftWidth: bw, borderTopLeftRadius: r }]} />
      <View style={[bracket, { top: 0, right: 0, borderTopWidth: bw, borderRightWidth: bw, borderTopRightRadius: r }]} />
      <View style={[bracket, { bottom: 0, left: 0, borderBottomWidth: bw, borderLeftWidth: bw, borderBottomLeftRadius: r }]} />
      <View style={[bracket, { bottom: 0, right: 0, borderBottomWidth: bw, borderRightWidth: bw, borderBottomRightRadius: r }]} />

      {/* Mini QR inside: three finder squares + data dots */}
      <View style={{ position: 'absolute', top: inset, left: inset, width: inner, height: inner }}>
        <View style={[finder, { top: 0, left: 0 }]} />
        <View style={[finder, { top: 0, right: 0 }]} />
        <View style={[finder, { bottom: 0, left: 0 }]} />
        <View style={{ position: 'absolute', right: 0, bottom: 0, width: dot, height: dot, backgroundColor: c }} />
        <View style={{ position: 'absolute', right: dot + 1, bottom: dot + 1, width: dot, height: dot, backgroundColor: c }} />
        <View style={{ position: 'absolute', right: 0, bottom: 2 * (dot + 1), width: dot, height: dot, backgroundColor: c }} />
      </View>
    </View>
  );
}
