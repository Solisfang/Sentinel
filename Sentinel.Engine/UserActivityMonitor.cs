using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Threading;

namespace Sentinel.Engine;

public class UserActivityMonitor
{
    private readonly DispatcherTimer _timer;
    private bool _wasIdle;
    private int _idleThresholdMs;
    private DateTime? _snoozeUntil;

    public event EventHandler? IdleDetected;
    public event EventHandler? UserActive;

    public bool SuppressDuringMedia { get; set; } = true;

    public bool IsSnoozed => _snoozeUntil.HasValue && DateTime.UtcNow < _snoozeUntil.Value;
    public int SnoozeSecondsRemaining => IsSnoozed
        ? (int)(_snoozeUntil!.Value - DateTime.UtcNow).TotalSeconds
        : 0;

    public bool IsRunning { get; private set; }

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
        IsRunning = true;
        Debug.WriteLine($"[Sentinel] UserActivityMonitor started. Idle threshold: {IdleThresholdSeconds}s.");
    }

    public void Stop()
    {
        _timer.Stop();
        IsRunning = false;
        Debug.WriteLine("[Sentinel] UserActivityMonitor stopped.");
    }

    public void Snooze(int minutes)
    {
        _snoozeUntil = DateTime.UtcNow.AddMinutes(minutes);
        _wasIdle = false;
        Debug.WriteLine($"[Sentinel] Idle detection snoozed for {minutes} minutes.");
    }

    public void CancelSnooze()
    {
        _snoozeUntil = null;
        Debug.WriteLine("[Sentinel] Snooze cancelled.");
    }

    private void OnTimerTick(object? sender, EventArgs e)
    {
        if (IsSnoozed) return;

        // Clear expired snooze
        if (_snoozeUntil.HasValue && DateTime.UtcNow >= _snoozeUntil.Value)
        {
            _snoozeUntil = null;
            Debug.WriteLine("[Sentinel] Snooze expired.");
        }

        uint idleMs = GetIdleTimeMs();
        bool isIdle = idleMs >= _idleThresholdMs;

        // Suppress idle detection if media is playing
        if (isIdle && SuppressDuringMedia && MediaDetector.IsAudioPlaying())
        {
            isIdle = false;
        }

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
