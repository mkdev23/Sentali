using NAudio.Wave;

public class AudioPlayer
{
    public static void PlayWav(string path)
    {
        using var audioFile = new AudioFileReader(path);
        using var outputDevice = new WaveOutEvent();
        outputDevice.Init(audioFile);
        outputDevice.Play();
        while (outputDevice.PlaybackState == PlaybackState.Playing)
        {
            Thread.Sleep(100);
        }
    }
}