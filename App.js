import React, { useState } from "react";
import { ActivityIndicator, Image, Linking, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
        <Image source={require("./assets/SagarSoft.logo.png")} style={styles.logo} />
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
          <Image source={require("./assets/SagarSoft.logo.png")} style={styles.splashLogo} />
          <Text style={styles.brandDark}>SagarSoft</Text>
          <ActivityIndicator size="large" color="#0e8a72" style={{ marginTop: 20 }} />
          <Text style={styles.loadingText}>Loading...</Text>
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
        onShouldStartLoadWithRequest={(request) => {
          const url = String(request.url || "");
          const isExternal =
            url.startsWith("whatsapp://") ||
            url.startsWith("intent://") ||
            url.includes("wa.me/") ||
            url.includes("api.whatsapp.com/");
          if (isExternal) {
            Linking.openURL(url).catch(() => {
              const fallback = url.startsWith("whatsapp://")
                ? url.replace("whatsapp://send", "https://api.whatsapp.com/send")
                : url;
              Linking.openURL(fallback).catch(() => {});
            });
            return false;
          }
          return true;
        }}
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
    backgroundColor: "#0b1f3a",
    alignItems: "center",
    justifyContent: "center"
  },
  splashLogo: { width: 96, height: 96, marginBottom: 8 },
  logo: { width: 72, height: 72, marginBottom: 8 },
  brandDark: { color: "#fff", fontSize: 22, fontWeight: "900", marginBottom: 4 },
  loadingText: { marginTop: 8, color: "#a0b8cc", fontWeight: "600", fontSize: 14 },
  centerPage: { flex: 1, backgroundColor: "#0b1f3a", alignItems: "center", justifyContent: "center", padding: 24 },
  brand: { color: "#fff", fontSize: 28, fontWeight: "900" },
  title: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 14 },
  message: { color: "#c7d4e5", fontSize: 15, marginTop: 8, textAlign: "center", lineHeight: 22 },
  button: { marginTop: 18, minHeight: 46, paddingHorizontal: 22, borderRadius: 8, backgroundColor: "#0e8a72", alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#fff", fontWeight: "900" }
});
