using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Sentinel.Engine;

/// <summary>
/// Detects whether audio is currently playing on the system
/// using the Windows Core Audio API (IAudioMeterInformation).
/// </summary>
public static class MediaDetector
{
    public static bool IsAudioPlaying()
    {
        try
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out var device);
            if (device == null) return false;

            var iidAudioMeter = typeof(IAudioMeterInformation).GUID;
            device.Activate(ref iidAudioMeter, 0, IntPtr.Zero, out var obj);

            if (obj is IAudioMeterInformation meter)
            {
                meter.GetPeakValue(out float peak);
                Marshal.ReleaseComObject(meter);
                Marshal.ReleaseComObject(device);
                Marshal.ReleaseComObject(enumerator);
                return peak > 0.001f;
            }

            Marshal.ReleaseComObject(device);
            Marshal.ReleaseComObject(enumerator);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sentinel] MediaDetector error: {ex.Message}");
        }
        return false;
    }

    #region COM Interop

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator { }

    private enum EDataFlow { eRender = 0 }
    private enum ERole { eMultimedia = 1 }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        int NotImpl1();
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, [MarshalAs(UnmanagedType.Interface)] out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioMeterInformation
    {
        int GetPeakValue(out float pfPeak);
    }

    #endregion
}
