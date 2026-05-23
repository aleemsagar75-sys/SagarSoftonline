import React, { useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";

const WEB_APP_URL = "https://sagarsoftonline.onrender.com/app/dashboard.html";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  if (failed) {
    return (
      <SafeAreaView style={styles.centerPage}>
        <StatusBar style="light" />
        <Text style={styles.brand}>SagarSoft</Text>
        <Text style={styles.title}>Unable to load app</Text>
        <Text style={styles.message}>Please check internet connection and make sure the web app is deployed.</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            setFailed(false);
            setLoading(true);
            setReloadKey((value) => value + 1);
          }}
        >
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      {loading && (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#0e8a72" />
          <Text style={styles.loadingText}>Loading SagarSoft...</Text>
        </View>
      )}
      <WebView
        key={reloadKey}
        source={{ uri: WEB_APP_URL }}
        style={styles.webview}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowFileAccess
        allowsBackForwardNavigationGestures
        setSupportMultipleWindows={false}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  webview: { flex: 1 },
  loader: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    backgroundColor: "#eef6f8",
    alignItems: "center",
    justifyContent: "center"
  },
  loadingText: { marginTop: 12, color: "#0f314a", fontWeight: "800" },
  centerPage: { flex: 1, backgroundColor: "#0b1f3a", alignItems: "center", justifyContent: "center", padding: 24 },
  brand: { color: "#fff", fontSize: 28, fontWeight: "900" },
  title: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 14 },
  message: { color: "#c7d4e5", fontSize: 15, marginTop: 8, textAlign: "center", lineHeight: 22 },
  button: { marginTop: 18, minHeight: 46, paddingHorizontal: 22, borderRadius: 8, backgroundColor: "#0e8a72", alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#fff", fontWeight: "900" }
});
