class Config
  def self.load(path)
    File.read(path)
  end

  def self.defaults
    { timeout: 30, retries: 3 }
  end
end
