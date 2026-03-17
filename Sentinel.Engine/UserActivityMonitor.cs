using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Threading;

namespace Sentinel.Engine;

public class UserActivityMonitor
{
    private readonly DispatcherTimer _timer;
    private bool _wasIdle;
    private int _idleThresholdMs;

    public event EventHandler? IdleDetected;
    public event EventHandler? UserActive;

    public int IdleThresholdSeconds
    {
        get => _idleThresholdMs / 1000;
        set => _idleThresholdMs = value * 1000;
    }

    public UserActivityMonitor(int idleThresholdSeconds = 45)
    {
        _idleThresholdMs = idleThresholdSeconds * 1000;
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
        Debug.WriteLine($"[Sentinel] UserActivityMonitor started. Idle threshold: {IdleThresholdSeconds}s.");
    }

    public void Stop()
    {
        _timer.Stop();
        Debug.WriteLine("[Sentinel] UserActivityMonitor stopped.");
    }

    private void OnTimerTick(object? sender, EventArgs e)
    {
        uint idleMs = GetIdleTimeMs();
        bool isIdle = idleMs >= _idleThresholdMs;

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
