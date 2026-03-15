public class Outer
{
    public class Inner
    {
        public string Value { get; set; }

        public string GetValue()
        {
            return Value;
        }
    }

    public void ProcessInner(Inner inner)
    {
        Console.WriteLine(inner.Value);
    }
}
