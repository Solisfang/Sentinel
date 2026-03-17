using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Threading;

namespace Sentinel.Engine;

public class UserActivityMonitor
{
    private const int IdleThresholdMs = 10_000; // 10 seconds for testing

    private readonly DispatcherTimer _timer;
    private bool _wasIdle;

    public event EventHandler? IdleDetected;
    public event EventHandler? UserActive;

    public UserActivityMonitor()
    {
        _timer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(1)
        };
        _timer.Tick += OnTimerTick;
    }

    public void Start()
    {
        _wasIdle = false;
        _timer.Start();
        Debug.WriteLine("[Sentinel] UserActivityMonitor started. Polling every 1s, idle threshold: 10s.");
    }

    public void Stop()
    {
        _timer.Stop();
        Debug.WriteLine("[Sentinel] UserActivityMonitor stopped.");
    }

    private void OnTimerTick(object? sender, EventArgs e)
    {
        uint idleMs = GetIdleTimeMs();
        bool isIdle = idleMs >= IdleThresholdMs;

        if (isIdle && !_wasIdle)
        {
            Debug.WriteLine($"[Sentinel] Idle Detected (idle for {idleMs}ms)");
            _wasIdle = true;
            IdleDetected?.Invoke(this, EventArgs.Empty);
        }
        else if (!isIdle && _wasIdle)
        {
            Debug.WriteLine("[Sentinel] User Active");
            _wasIdle = false;
            UserActive?.Invoke(this, EventArgs.Empty);
        }
    }

    private static uint GetIdleTimeMs()
    {
        var lastInput = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };

        if (!GetLastInputInfo(ref lastInput))
            return 0;

        // Handle tick count overflow (wraps every ~24.9 days)
        uint currentTick = (uint)Environment.TickCount;
        return unchecked(currentTick - lastInput.dwTime);
    }

    #region P/Invoke

    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    #endregion
}
