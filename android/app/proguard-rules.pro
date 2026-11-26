# kotlinx.serialization: keep generated serializers for API models.
-keepattributes *Annotation*, InnerClasses, Signature, Exceptions
-keepclassmembers @kotlinx.serialization.Serializable class com.nearvolt.ev.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.nearvolt.ev.**$$serializer { *; }
# Retrofit service interfaces use reflection on method signatures.
-keep,allowobfuscation interface com.nearvolt.ev.data.api.ApiService
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-if interface * { @retrofit2.http.* public *** *(...); }
-keep,allowoptimization,allowshrinking,allowobfuscation class <3>
# Strip verbose logging in release.
-assumenosideeffects class android.util.Log { public static int v(...); public static int d(...); public static int i(...); }
