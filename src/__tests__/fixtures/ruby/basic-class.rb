class User
  def initialize(name, email)
    @name = name
    @email = email
  end

  def greet
    "Hello, #{@name}"
  end

  def email
    @email
  end
end
